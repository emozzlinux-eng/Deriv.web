# 🚀 DERIV INTELLIGENCE

**AI-Powered Deriv Analysis, Risk Management & Controlled Trading Platform**

A professional trading workstation for [Deriv](https://deriv.com) where
**analysis, risk management and execution are separate systems**. This
repository currently contains the project **specification and governance
rules** — implementation follows the phased roadmap below.

> ⚠️ Trading involves substantial risk of loss. This platform never claims
> guaranteed profits or predictive certainty; signal scores measure *technical
> setup strength*, not win probability. Real trading is disabled by default.

## Repository layout

```text
.
├── MASTER_PROMPT.md      # Index: role, principles, and links to all rule modules
├── docs/
│   ├── PROJECT_AUDIT.md  # Phase 0 audit of the repository (required first step)
│   └── specs/            # Numbered specification modules (00–96), one file per rule
├── .env.example          # Environment variable template (no secrets)
├── .gitignore
└── LICENSE               # MIT
```

The target application structure (a `apps/web` + `packages/*` monorepo with
Supabase backend) is defined in
[§8 Repository Structure](docs/specs/08-repository-structure.md).

## How to work with this spec

1. Start with [MASTER_PROMPT.md](MASTER_PROMPT.md) — it defines the engineer's
   role and links every numbered section to its own module file.
2. Read the safety-critical sections first:
   [Absolute Rules](docs/specs/95-absolute-rules.md),
   [Fail-Safe Rule](docs/specs/65-fail-safe-rule.md),
   [Real Money Rule](docs/specs/92-real-money-rule.md),
   [Risk Engine](docs/specs/38-risk-engine.md).
3. Before any code: complete the
   [Phase 0 Project Audit](docs/PROJECT_AUDIT.md) and wait for user approval
   ([§88](docs/specs/88-phase-0-must-be-first.md)).
4. Implement in phases only — never all at once
   ([§3 Development Philosophy](docs/specs/03-development-philosophy.md)).

## Roadmap (summary)

Phase 0 audit → 1 architecture → 2 Supabase/RLS → 3 auth → 4 security center →
5 Deriv connection → 6 market data → 7 charts → 8 indicators → 9 MTF analysis →
10 scanner → 11 signals → 12 risk engine → 13 paper trading → 14 backtesting →
15 strategy lab → 16 demo trading → 17 AI analyst → 18 alerts → 19 Telegram →
20 terminal/TUI → 21 controlled real trading → 22 performance → 23 security
audit → 24 production deployment.
Full details: [§87 Phase Plan](docs/specs/87-phase-plan.md).

## Technology stack

Next.js · React · TypeScript · Tailwind · shadcn/ui · Zustand · Zod ·
Lightweight Charts · Supabase (Auth, PostgreSQL+RLS, Realtime, Edge Functions) ·
Netlify · optional Python engine (Rich/Textual TUI).
See [§5 Technology Stack](docs/specs/05-technology-stack.md).

## Security policy

- Never commit secrets (`.env*`, keys, credentials) — enforced by `.gitignore`
  and required GitHub secret scanning ([§17](docs/specs/17-github-security.md)).
- Deriv credentials stay server-side only ([§15](docs/specs/15-deriv-credential-security.md)).
- RLS on every user-owned table ([§19](docs/specs/19-row-level-security.md)).

## License

[MIT](LICENSE)
