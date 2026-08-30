# 01: Repository and workspace scaffold

**What to build:** Turn the empty `goblin-foundry` directory into a running project: a git repository with a GitHub remote, a Bun workspace (`api`, `web`, `shared`, `cli`), a Hono server that serves a Vite/React shell, one SQLite database accessed through Drizzle's async API behind a single database seam, and the two test harnesses every later ticket will use. `bun dev` opens a page that shows the ticket-key prefix read from the `setting` table (default `GF`). Start `LESSONS.md`.

Respect ADR-0001 (SQLite via Drizzle, `drizzle-kit push` locally, no Drizzle transactions for correctness, no sync driver calls) and DESIGN.md (tokens.css wired in, IBM Plex Sans + JetBrains Mono, Everforest dark, flat).

**Blocked by:** None (can start immediately)

**Status:** done (commits bc0e5bf..8fcf522 on main, 2026-08-27; reviewed twice)

- [x] `git init` done, first commit, GitHub remote configured; `.gitignore` excludes the database and build output
- [x] Bun workspaces `api`, `web`, `shared`, `cli` exist and `bun install` / `bun run build` / `bun test` succeed from the root
- [x] `bun dev` serves the GUI shell from the API process on localhost only; page renders the prefix from `setting`
- [x] Database lives at `~/.goblin-foundry/foundry.db` (WAL) by default and at a temp path when a test env var is set; only the seam module imports the driver
- [x] In-process API test harness: a test creates a fresh temp database, calls the Hono app without a socket, asserts the settings endpoint — green
- [x] Playwright smoke harness: one test loads the shell against a temp database — green
- [x] `LESSONS.md` exists with the first entry
