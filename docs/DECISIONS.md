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
