# Features (Release 1)

Legend: ✅ implemented & tested · ⚠ implemented with caveat

## Platform

| Feature | Status | Notes |
|---|---|---|
| Registration, login, logout, password reset, protected routes, profile | ✅ | Supabase Auth; generic error messages; verified e2e (mock backend) |
| Light / dark / system theme, persisted, tokens only | ✅ | Monaco, Mermaid, charts, React Flow follow tokens |
| Responsive shell, collapsible sidebar, project selector, global search (Ctrl+K), notifications, AI shortcut | ✅ | |
| Dashboard with real statistics, recent projects/activity, quick actions, AI usage | ✅ | No fabricated quota |
| Project management: create, rename, describe, platform, delete (with file deletion), version history | ✅ | |

## Ingestion

| Feature | Status | Notes |
|---|---|---|
| Upload `.dacpac` / `.sql` with extension + magic-byte + size validation | ✅ | Direct-to-Storage signed upload |
| Async import jobs with statuses, progress, warnings, errors, retry | ✅ | PostgreSQL queue |
| DACPAC extraction (DacFx) and DDL parsing (ScriptDom, GO batches, line-numbered errors) | ✅ | 129 .NET tests; unsupported objects reported, not dropped |
| Idempotent persistence, ZIP-bomb / traversal protection | ✅ | |
| Worker ↔ real Supabase | ⚠ | SQL compiled and faked in tests; integration run required (see SECURITY.md) |

## Database Intelligence

Overview (counts, charts, limitations, warnings) · Table explorer with search/filter · column details · original CREATE definitions (reconstructed ones are labelled) · relationships (declared vs inferred) · indexes & constraints · views · stored procedures (parameters, reads/writes, operations, dynamic SQL, temp tables, transactions, Mermaid flow) · functions · triggers · dependency explorer (React Flow, expand/collapse, incoming/outgoing highlight, confidence legend, PNG/SVG export) · ER diagrams (expand/collapse, search, schema filter, export) · column impact analysis · documentation export (Markdown) — all ✅ (e2e on synthetic data).

## SQL Intelligence

| Feature | Status |
|---|---|
| Monaco workspace: tabs, formatting (sql-formatter), copy/download, save, rename, tags, favorites, duplicate, version history/restore, full screen, dialect profiles (T-SQL, PostgreSQL, MySQL, SQLite) | ✅ |
| Script analyzer: statement breakdown, tables/columns affected, data-impact text, risk levels, safer alternatives, SELECT preview for UPDATE/DELETE | ✅ (token-based; heuristic findings labelled) |
| Risk rules: UPDATE/DELETE without WHERE (incl. `1=1`), DROP/TRUNCATE, DROP COLUMN, missing/unbalanced transactions, `= NULL`, `NOT IN` hazard, `SELECT *`, cross joins, NOLOCK, leading-wildcard LIKE, nested subqueries, dynamic SQL & injection patterns, xp_cmdshell/OPENROWSET | ✅ |
| History of explanations, generations, analyses, comparisons, migrations, conversations; search/filter; continue conversation; save to library | ✅ |

## AI (optional)

Gemini and OpenRouter providers behind one interface · model selection from live lists · encrypted per-user keys or server env keys · key validation · request history · retries/backoff/timeouts · free-only OpenRouter guard · explicit consent · SQL explanation, generation (with missing-information questions, preview SELECT, transaction advice, static risk check), optimization, object explanation, metadata-grounded chat with verified object references. ✅ unit-tested with mocked providers; live provider calls need your key (not exercised in CI).

## Comparison & Migration

Version diff across schemas, tables, columns, types, nullability, defaults, keys, FKs, unique/check/default constraints, indexes, views, procedures, functions, triggers; added/removed/modified/unchanged; destructive changes flagged; report download · migration plan (ordered steps, SQL, rollback *suggestions*, pre/post validation queries, checklist, risks, prerequisites) with destructive statements commented out by default — ✅.

## Not in Release 1

Data ingestion (BACPAC/CSV), data profiling, live database connections, Query Store/execution plans, team workspaces. See [RELEASE_ROADMAP.md](RELEASE_ROADMAP.md).
