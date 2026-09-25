# PROJECT AUDIT — DERIV INTELLIGENCE

**Audit date:** 2026-09-25
**Repository state audited:** commit `4529c4c` ("Create MASTER_PROMPT.md")

## 1. Current architecture

The repository is a **specification-only project**. It contains no application
code, configuration, or tooling yet — only the master prompt document and a
license file. (This audit itself now adds the refactored documentation set.)

## 2. Existing technologies

| Item            | Status                                             |
|-----------------|----------------------------------------------------|
| Language        | None (Markdown only)                               |
| Framework       | None — Next.js is *mandated* by the spec, not built|
| Package manager | None (`package.json` absent)                       |
| Node version    | Not pinned                                         |
| Database        | None — Supabase PostgreSQL is specified only       |
| Authentication  | None — Supabase Auth is specified only             |
| API routes      | None                                               |
| Environment vars| None (`.env.example` absent)                       |
| Tests           | None                                               |
| Lint config     | None                                               |
| TypeScript conf | None                                               |
| Deployment conf | None (Netlify is specified only)                   |
| Git state       | Clean working tree; branches: `main`, current topic branch |

## 3. Existing folder structure (before refactor)

```text
/workspace
├── LICENSE              # MIT license
└── MASTER_PROMPT.md     # 2,633-line monolithic specification
```

## 4. Existing database

None. The 17 core tables (`profiles`, `deriv_accounts`, `markets`, `candles`,
`signals`, …) listed in the spec exist only as requirements.

## 5. Existing authentication

None.

## 6. Existing APIs

None. The Deriv client/WebSocket manager are specified but unimplemented.

## 7. Existing UI

None. Login layout, Security Center, Dashboard, etc. are wireframe-style
requirements inside the spec.

## 8. Existing problems

1. **Monolithic specification** — a single 2,633-line document with 96 flat
   sections; hard to navigate, review, cite, or update incrementally.
2. **Inconsistent heading semantics** — numbered rules used top-level `#`
   headings, colliding with real document titles (`# DERIV INTELLIGENCE`,
   `# PROJECT AUDIT`) and producing a broken outline.
3. **Duplication** — the architecture diagram appears twice (§6, §94); safety
   rules are restated across many sections without cross-references.
4. **No README** — nothing explains what the repository is or how to start.
5. **No `.gitignore`** — risky given the spec's own secrets policy (§17).
6. **No code, tests, CI, or env scaffolding** — Phase 1+ has no foundation.

## 9. Security problems

- No `.gitignore`, so a future `.env.local`, `*.key`, `credentials.json` could
  be committed accidentally (violates spec §16–§17). **Mitigated**: added.
- No secret scanning / Dependabot configuration exists yet (GitHub settings +
  dependabot.yml still recommended).

## 10. Performance problems

N/A for code (none exists). Documentation performance concern: the monolith
forced loading the entire spec for any single question. **Mitigated** by
modularization.

## 11. Technical debt

Entirely pre-code at this stage; the main debt was the unstructured spec, now
refactored into indexed modules under `docs/specs/`.

## 12. Missing components

Everything in spec §8: `apps/web`, `apps/terminal`, all engine packages,
`supabase/functions`, `supabase/migrations`, `tests/`, `scripts/`, CI, README,
env examples.

## 13. Recommended architecture

Adopt the modular monorepo exactly as specified in
[§8 Repository Structure](specs/08-repository-structure.md), keeping the
mandatory pipeline separation of
[§7 Core Architectural Separation](specs/07-core-architectural-separation.md):
Market Data → Analysis → Signal → Risk → Execution.

Documentation architecture (new): root `MASTER_PROMPT.md` acts as an index;
each numbered rule lives in its own citable file under `docs/specs/`.

## 14. Migration risks

Minimal — no code or data exists. The only risk is stale references to old
section numbers; the index preserves the original numbering (0–95 + START NOW)
so existing citations remain valid.

---

**Next step per spec §4/§88:** present this audit plus the phase roadmap and
wait for user approval before implementing Phase 1.
