# Kickoff: build M0 of Goblin Foundry

You are helping me build **Goblin Foundry**, my personal agentic software factory, in this repo (`/Users/roze/dev/factory`). The plan is done; this session is for building the first milestone (M0, the thin vertical slice). Do not re-litigate the plan; build it, and ask me only when a decision genuinely changes the work.

## Read first (in this order)
1. `docs/plan/factory-blueprint.html` — the full plan (v0.3). Read the whole thing; it is the spec. Sections that matter most for M0: Object model, Status machine, Architecture, Observability (event schema), Per-project policy, Roadmap → M0.
2. `docs/research/04-claude-runtime-observability.md` — exact Agent SDK options, hook payloads, `modelUsage`, `sessionStore`, `canUseTool`, worktree notes. Use its §5 "Recommended architecture" for the worker.
3. `docs/research/03-zero-localfirst.md` — Zero setup, the zbugs schema to start from, deployment, and why the live event stream bypasses Zero (SSE).
4. Skim `docs/research/01-disler-factory.md` §2–3 for the event/envelope/gate contract we are adapting, and `docs/research/06-methodology.md` Part B for the design-doc template and builder definition-of-done.

Persistent memory for this project also exists in `~/.claude/projects/-Users-roze-dev-factory/memory/` — read `MEMORY.md` and the linked project note.

Also know the lineage: the user's existing skill stack **smriti** (`~/dev/smriti`, data in `~/.smriti/factory.db`) is the proto-factory — apps/projects/tickets/runs/events/documents tables, an HTML board, and the philosophy this factory adopts: **"the paper trail is stored, not linked; nothing is ever committed into your repo."** Skim its README ("The factory" section). In M1 we import its data; in M0 just don't contradict its taste. App #1 will be **Subway Reader** (`~/dev/subway-reader`, currently an empty git init) — an offline-first, e-ink-first Android app (Kotlin/Compose, Boox); its 17 tickets + dependency DAG already live in smriti's factory.db.

## What the factory is (one paragraph)
A Linear-like ticket system (Projects / Tickets / Designs) on **Rocicorp Zero + Postgres**, whose status transitions trigger **Claude agents** (planner, builder, reviewer, deployer, librarian, scout, and a per-project Conductor) running via the **Claude Agent SDK** in a worker, one `query()` per phase, one git worktree per ticket. Everything the agents do streams into an event log rendered as **swim lanes** (per phase: compiled prompt, tool calls, gates, cost). "Done" means merged and deployed. Rigor is **per-project policy** (serious / standard / vibe). It must be usable from a phone for status + approvals (later via a Factory MCP server).

## Locked decisions (do not reopen)
- TypeScript everywhere; pnpm monorepo: `apps/web` (Vite + React + Zero client), `apps/api` (Node/Hono: SSE feed, approvals, policy, scheduler; hosts zero-cache alongside), `apps/worker` (Agent SDK runner, gates, worktrees), `packages/schema` (Zero schema + zod types), `packages/skills`, `packages/mcp` (later), `infra/` (docker-compose: Postgres with `wal_level=logical`, zero-cache).
- Object model: Project (policy, statuses, project design) → Ticket → Design vN; Ticket → Run → Phase → Event; Envelope + Gate results; Question. **A ticket is not a run.**
- Statuses have fixed **kinds** (`backlog, ready_for_design, designing, design_review, ready_for_dev, building, in_review, ready_to_merge, deploying, done, canceled`) and per-project names: table `statuses(project_id, kind, name, color, order, enabled)` from day one.
- Zero syncs stable/interactive data (projects, tickets, designs, run + phase summaries, capped event tail). The live firehose goes worker → Postgres → NOTIFY → api SSE → browser. Full events stay in Postgres for the paged trace view.
- Agents run in the worker via the TypeScript Agent SDK: per-phase `model`, `effort`, `allowedTools`, `maxTurns`, `maxBudgetUsd`, JSON-schema `outputFormat` for the envelope; hooks → tool events (PreToolUse insert, PostToolUse update with `duration_ms`); `result.modelUsage` → cost (never `usage`); `sessionStore` → transcripts. Auth: my Claude Max subscription token (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) by default, with an `ANTHROPIC_API_KEY` failover per phase.
- Envelope base: `{status: "success"|"fail", summary, artifacts[], notes_for_next_agent}`. Gates return `checks: [{item, ok, note}]` — evidence, not just pass/fail. Failed gate → re-prompt the same session (correction, not restart), bounded by policy retries.
- **Designs are stored, never committed** (smriti's rule; the user's explicit call): design.md lives in the factory DB; the worker materializes it into the worktree at a git-ignored path at run start; commit trailers reference the design version. The repo keeps only CLAUDE.md/AGENTS.md (+ rare ADRs). Do NOT create `docs/designs/` in target repos.
- Notifications: ntfy (M1). Mockups: HTML (never Figma unless policy says so).
- Single user, single token auth for the web UI. No multi-tenancy. Not a product.
- Name: **Goblin Foundry**. Package scope `@goblin/`, CLI binary `goblin`, GitHub repo `goblin-foundry` when pushed. The local dir stays `~/dev/factory` for now. Agents are goblins; the Conductor is the Foreman — use the theme in naming where it stays clear (`apps/worker` can be the "forge"), never where it obscures.

## M0 goal — the thin vertical slice
One ticket goes **Backlog → Ready for Design → (planner in my terminal) → Design Review → approve on the web → Ready for Dev → builder in a worktree → PR**, while I watch a live run trace. Concretely:

1. **Scaffold** the monorepo, `infra/docker-compose.yml` (Postgres + zero-cache), env handling, `just`/pnpm scripts to run everything.
2. **Schema** (`packages/schema`): Zero tables from a zbugs subset (project, ticket, comment, label) plus `statuses`, `designs`, `runs`, `phases`, `events`, `envelopes`, `gates`, `questions`. Use the column shapes from the blueprint's Observability section. Seed one project (this repo itself) with the *standard* preset hard-coded.
3. **Web** (`apps/web`): board (status kinds as columns, drag to move), ticket page (body, design tab, runs tab), run trace (swim lanes per phase, tool calls on a time axis, event feed over SSE, click a phase for its envelope/gates/cost), an Approve button on Design Review. Must be usable on a phone; the trace can be desktop-first.
4. **API** (`apps/api`): SSE `/runs/:id/events` (cursor over `events`, live tail = history), endpoints the planner skill needs (create/update design, move status), approval endpoint.
5. **Worker** (`apps/worker`): claim tickets in `ready_for_dev` with a lease + heartbeat; create a worktree; run the **builder** phase via the Agent SDK with hooks writing `events`, `modelUsage` writing cost, envelope validation, two gates (`tests_pass` using the project's test command, `diff_matches_claims`); open a PR with `gh`; move the ticket to `in_review`; clean up the worktree.
6. **Planner v0**: a `/plan <TICKET-ID>` skill in `packages/skills` that I run in my own Claude Code terminal: fetches the ticket, runs a grill-me interview (frontier of questions with recommended answers, repeat until empty), writes `design.md` per the template in `docs/research/06-methodology.md` §6, saves it via the API as Design v1 (DB only — never committed), and moves the ticket to `design_review`.

**Done when:** I approve a design in the web UI at night and wake up to a PR with gate evidence, having watched (or replayed) every tool call and the cost.

## Out of scope for M0
Reviewer, deployer, librarian, scout, Conductor, `review.html` mockups, per-project policy file, MCP server, notifications, multi-worker, cloud hosting. Leave clean seams for them (phase runner is generic; policy is a typed object even if hard-coded).

## Working agreements
- Start by proposing a short build order and the first commit; then build in small, runnable increments. Prefer working software over completeness at every step.
- Keep `docs/DECISIONS.md` (append-only, one line per decision with why) and `docs/LESSONS.md` (things that bit you). Update `CLAUDE.md` with run/test commands as they exist.
- Verify each increment yourself (run it, curl it, screenshot it) before telling me it works. Report failures plainly with output.
- If Zero or the Agent SDK API differs from the research docs, trust the installed package's types and the official docs, note the difference in `docs/LESSONS.md`, and continue.
- Ask me only when a choice changes the product (not for library picks, file layout, or naming); batch questions.
- Conventional commits; commit after each working increment on a `m0/thin-slice` branch.
