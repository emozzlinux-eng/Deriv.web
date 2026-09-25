# DATABASE

Use Supabase PostgreSQL.

Core tables:

```text
profiles
deriv_accounts
markets
candles
signals
strategies
strategy_rules
risk_profiles
paper_trades
trades
positions
backtests
journal_entries
performance_snapshots
alerts
audit_logs
system_events
```

Every user-owned table must include:

```text
user_id
```

where appropriate.

---
