# Decisions

Append-only. One line per decision, with why. Decisions locked before the build
started live in `docs/plan/factory-blueprint.html`; this file records what the
build itself decided.

- 2026-08-19 — M0 branch is `m0/thin-slice`, conventional commits. Why: kickoff agreement.
- 2026-08-19 — Postgres 17-alpine in docker on port 6432; Zero's `zero_cvr`/`zero_change` are separate databases in the same instance. Why: one container to run, no clash with a system Postgres on 5432.
- 2026-08-19 — zero-cache runs from the workspace (`just zero`), not docker-compose. Why: it needs the compiled Zero schema from `packages/schema`; mounting build output into a container buys nothing on a single dev box.
- 2026-08-19 — Postgres is snake_case; the Zero schema maps every table/column with `.from()`. Why: the worker writes raw SQL constantly, and Zero's mapping is free.
- 2026-08-19 — `event` and `transcript_entry` are excluded from Zero (publication `goblin_zero` names the synced tables explicitly). Why: the firehose goes worker → Postgres → NOTIFY → SSE; syncing it would push thousands of rows per run through logical replication and IVM.
- 2026-08-19 — Tickets point at a `status` row (`status_id`), and agents trigger on `status.kind`. Why: one source of truth for the ticket's state; kinds stay canonical while names stay per-project.
- 2026-08-19 — Timestamps are `timestamptz` in Postgres and `number()` (epoch ms) in Zero. Why: Zero maps them natively, so SQL keeps real time types.
- 2026-08-19 — Reads go through Zero (client ZQL); writes that mean something (status moves, design create/approve) go through REST on the API. Why: no custom-mutator/push plumbing in M0, and every writer — browser, planner skill, worker — uses one audited path.
- 2026-08-19 — The SSE stream accepts `?token=` as well as a bearer header. Why: browser `EventSource` cannot set headers.
- 2026-08-19 — UI reads go through named synced queries in `packages/schema/src/queries.ts`, served by the API at `/zero/query`. Why: client ZQL is legacy in Zero 1.9 and syncs nothing; this is the path Zero is keeping.
- 2026-08-19 — The web app is a hash-routed Vite app with no router dependency, styled from the blueprint's own palette. Why: three views, and the factory should look like its plan.
- 2026-08-19 — The builder runs with `permissionMode: 'bypassPermissions'` and `settingSources: []`, with a PreToolUse hook as the actual boundary. Why: hook denies apply even under bypass, so one guard covers every call — path escapes, git redirection, and policy protected paths — instead of relying on permission-rule syntax.
- 2026-08-19 — Worktrees are cut with `git worktree add -B` after a forced remove and prune. Why: `-p` runs never clean up, so a killed worker leaves a worktree and branch that would otherwise be silently reused by the next attempt.
- 2026-08-19 — The builder's prompt embeds the envelope's JSON Schema generated from the zod type. Why: disler's "synced triad" (type, prompt example, call site) drifts; generating the example removes the failure mode.
- 2026-08-19 — The planner is a skill (`/plan`) linked into `.claude/skills` by `just install-skills`, not a worker phase. Why: M0 scope — it runs in the user's terminal and writes back through the API.
- 2026-08-20 — The builder subprocess gets an explicit `env` with the factory's secrets removed, and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` so the agent's own shell commands cannot read the Anthropic credential either. Why: the subprocess must hold its own credential to authenticate, so the boundary has to be one level down, at the commands the agent runs.
- 2026-08-20 — Stalled runs are swept at the top of every worker tick, not by a separate process. Why: the worker is the only thing that must be running for this to matter, and a reaper nobody starts is a reaper that does not exist.
- 2026-08-20 — A stalled ticket is requeued up to 3 failures, then left in `building` for a human. Why: the blueprint's "3 retries, then escalate" — a laptop that sleeps mid-run should recover itself; a ticket that keeps dying should stop trying.
- 2026-08-20 — M1's hand-built work lands on branch `m1` (the worktree's own branch), not `m1/<slug>`. Why: git cannot hold `m1` and `m1/questions` at once, and the M1 worktree is already checked out on `m1`; factory-built work keeps its own `goblin/fac-*` branches.
- 2026-08-20 — The planner's questions, the design gate, and the planner phase itself are hand-built, not run through the factory. Why: the kickoff's chicken-and-egg exception — they are the machinery a planner run depends on.
- 2026-08-20 — A run asks you something through `AskUserQuestion`, intercepted in `canUseTool`, and waits there. Why: it is the model's own tool, so the agent needs no special prompt vocabulary, and the callback may stay pending indefinitely, which is exactly "the run waits for you".
- 2026-08-20 — The worker waits for an answer by polling the `question` row every 2s, not by LISTEN. Why: the answer arrives through the API from a browser or a phone; one cheap query beats a second NOTIFY channel that has to survive a dropped connection.
- 2026-08-20 — The planner writes two documents: `design_markdown` for the builder and `review_html` for you, gated by `review_readable` (no scripts, no external resources) because it renders in a sandboxed iframe. Why: the blueprint's two-outputs rule, and a document a human reads is not the same artifact as a specification a builder implements.
- 2026-08-20 — Annotations accumulate on the design and are handed to the next planner run as answers, not questions. Why: you already said it once; a planner that asks it again has wasted the round.
- 2026-08-20 — The review fix loop lives inside the reviewer phase, opening a `builder_fix_N` phase per loop, rather than as a loop in the sequencer. Why: the sequencer stays a straight line of phases, and the loop is the reviewer's own bounded correction — the same shape as a failed gate.
- 2026-08-20 — A reviewer run attaches a worktree to the existing branch and diffs against its merge-base with the default branch. Why: the build that produced the branch removed its worktree, and the change under review is the branch's own work, not everything main has done since.
- 2026-08-20 — A ticket whose last run for the same trigger failed is not re-claimed until the ticket is touched. Why: the review pipeline leaves the ticket in In Review, so without this a failed review would loop forever; moving the card is how you say "try again".
- 2026-08-20 — Budget exhaustion and usage limits are named terminal reasons that end a phase immediately, never retried. Why: a retry buys the same failure at the same price, and "worker_error" hides the one failure a human can actually fix.
- 2026-08-20 — The per-ticket budget is checked between phases against the run's accumulated cost. Why: `maxBudgetUsd` is per `query()`, so a phase that retries three times can spend three times its cap without anything noticing.
- 2026-08-20 — Every answer you have given on a ticket goes into the next planner run's opening prompt as settled. Why: a run that dies mid-interview must not cost you the interview.
