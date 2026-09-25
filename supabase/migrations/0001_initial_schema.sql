-- ============================================================================
-- DERIV INTELLIGENCE — initial schema (spec §18–§20)
-- Supabase PostgreSQL. All user-owned tables have user_id + RLS (§19).
-- Auth is Supabase Auth — passwords are NEVER stored here (§10, §11).
-- ============================================================================

-- profiles: one row per auth.users row
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.deriv_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  account_type text not null check (account_type in ('DEMO','REAL')),
  loginid text,
  -- tokens live ONLY in secure backend storage; never plaintext here (§15)
  token_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.markets (
  symbol text primary key,
  display_name text not null,
  active boolean not null default true,
  pip_size numeric
);

create table if not exists public.candles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null references public.markets(symbol),
  timeframe text not null,
  open_time timestamptz not null,
  open numeric not null, high numeric not null, low numeric not null, close numeric not null,
  tick_count integer not null default 0,
  unique (user_id, symbol, timeframe, open_time)
);
create index if not exists candles_lookup_idx on public.candles (symbol, timeframe, open_time desc);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  market text not null,
  direction text not null check (direction in ('BUY','SELL')),
  timeframe text not null,
  setup text not null,
  strength integer not null check (strength between 0 and 100),
  risk_level text not null check (risk_level in ('LOW','MEDIUM','HIGH')),
  evidence jsonb not null default '[]',
  invalidation text not null,
  data_quality text not null check (data_quality in ('FRESH','STALE','DEGRADED')),
  state text not null check (state in ('BUY_SETUP','SELL_SETUP','WAIT','NO_TRADE')),
  created_at timestamptz not null default now()
);

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  market text,
  timeframe text,
  risk_mode text not null default 'CONSERVATIVE' check (risk_mode in ('CONSERVATIVE','BALANCED','AGGRESSIVE','CUSTOM')),
  mode text not null default 'PAPER' check (mode in ('BACKTEST','PAPER','DEMO','REAL')),
  real_activated boolean not null default false, -- REAL requires explicit activation (§42/§46)
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_rules (
  id bigint generated always as identity primary key,
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null check (phase in ('ENTRY','EXIT')),
  rule jsonb not null, -- serialized IF/AND/OR/NOT tree (§43)
  position integer not null default 0
);

create table if not exists public.risk_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  max_stake numeric not null,
  max_daily_loss numeric not null,
  max_session_loss numeric not null,
  max_open_positions integer not null,
  max_exposure numeric not null,
  max_trades_per_day integer not null,
  max_consecutive_losses integer not null,
  cooldown_minutes integer not null,
  unique (user_id, name)
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null unique,      -- duplicate-trade protection (§50)
  signal_id uuid references public.signals(id),
  symbol text not null,
  direction text not null check (direction in ('BUY','SELL')),
  stake numeric not null,
  entry_price numeric, exit_price numeric,
  pnl numeric,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','BLOCKED','ERROR')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null unique,      -- duplicate-trade protection (§50)
  deriv_contract_id text,
  symbol text not null,
  direction text not null check (direction in ('BUY','SELL')),
  stake numeric not null,
  payout numeric,
  pnl numeric,
  status text not null default 'PENDING' check (status in ('PENDING','OPEN','CLOSED','BLOCKED','ERROR','UNKNOWN')),
  mode text not null check (mode in ('DEMO','REAL')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid references public.trades(id),
  paper_trade_id uuid references public.paper_trades(id),
  symbol text not null,
  exposure numeric not null default 0,
  opened_at timestamptz not null default now()
);

create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid references public.strategies(id),
  market text not null,
  timeframe text not null,
  params jsonb not null,
  stats jsonb not null,   -- P/L, win rate, drawdown, profit factor, streaks, equity curve (§41)
  created_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid,
  market text not null,
  direction text not null,
  stake numeric,
  strategy text,
  signal jsonb,
  risk text,
  result text,
  pnl numeric,
  notes text,
  tags text[] not null default '{}',
  screenshot_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  balance numeric not null,
  today_pl numeric, week_pl numeric, month_pl numeric, total_pl numeric,
  drawdown numeric, win_rate numeric, profit_factor numeric, trades integer,
  unique (user_id, snapshot_date)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'STRONG_SETUP','RISK_BLOCKED','TRADE_EXECUTED','TRADE_CLOSED','DAILY_LOSS_REACHED',
    'CONNECTION_LOST','CONNECTION_RESTORED','REAL_MODE_ENABLED','AUTOMATION_ENABLED','SECURITY_EVENT')),
  payload jsonb not null default '{}',
  channels text[] not null default '{browser}',
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.system_events (
  id bigint generated always as identity primary key,
  event text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARN','CRITICAL')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (§19): a user may only access their own data.
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.deriv_accounts      enable row level security;
alter table public.candles             enable row level security;
alter table public.signals             enable row level security;
alter table public.strategies          enable row level security;
alter table public.strategy_rules      enable row level security;
alter table public.risk_profiles       enable row level security;
alter table public.paper_trades        enable row level security;
alter table public.trades              enable row level security;
alter table public.positions           enable row level security;
alter table public.backtests           enable row level security;
alter table public.journal_entries     enable row level security;
alter table public.performance_snapshots enable row level security;
alter table public.alerts              enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.system_events       enable row level security;
-- markets is reference data: readable by authenticated users, no user_id.
alter table public.markets             enable row level security;

-- Per-table owner policies (auth.uid() = user_id)
do $$
declare t text;
begin
  foreach t in array array[
    'deriv_accounts','candles','signals','strategies','strategy_rules','risk_profiles',
    'paper_trades','trades','positions','backtests','journal_entries',
    'performance_snapshots','alerts','audit_logs'
  ] loop
    execute format('drop policy if exists "%s_owner" on public.%I;', t, t);
    execute format('create policy "%s_owner" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t, t);
  end loop;
end $$;

drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "markets_read" on public.markets;
create policy "markets_read" on public.markets for select to authenticated using (true);

-- system_events: service-role only (RLS with no policies denies all non-service access)
