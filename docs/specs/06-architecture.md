# ARCHITECTURE

Use:

```text
                    USER
                      │
                      ▼
             ┌─────────────────┐
             │     NEXT.JS     │
             │    NETLIFY      │
             └────────┬────────┘
                      │
                   HTTPS
                      │
                      ▼
             ┌─────────────────┐
             │    SUPABASE     │
             │                 │
             │ Auth            │
             │ PostgreSQL      │
             │ RLS             │
             │ Realtime        │
             │ Edge Functions  │
             └────────┬────────┘
                      │
                      ▼
                ┌───────────┐
                │ DERIV API │
                └───────────┘
```

Optional local engine:

```text
MacBook
   │
   ├── Advanced scanner
   ├── Backtester
   ├── AI analysis
   ├── Strategy engine
   └── Terminal/TUI
           │
           ▼
       Supabase
```

---
