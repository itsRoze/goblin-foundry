# Goblin Foundry v0 (`~/dev/factory`) — technical post-mortem

- **Repo:** `/Users/roze/dev/factory` (`main` at `1e38b0d`, 28 commits, stale since 2026-08-21). The real code is on branch `m1` at `/Users/roze/.herdr/worktrees/factory/m1` (`99717c4`, 84 commits) plus six `goblin/fac-*` branches the factory built itself. 101 commits total, 2026-08-19 → 2026-08-26.
- **Spec:** `docs/plan/factory-blueprint.html` v1.3 (M0 marked "SHIPPED 20 Aug 2026 · built in ~2 days"). Research: `docs/research/01..07-*.md`, 8,067 lines.
- **Live DB:** `goblin-postgres` container, db `factory` — 18 tables, 163 columns, 115 MB (event 19 MB, transcript_entry 80 MB). 94 runs, 2026-08-20 01:54 → 2026-08-26 14:56.
- **Written:** 2026-08-26.

## 1. Summary

v0 was a Linear-clone-plus-worker: Postgres + Rocicorp Zero for the board, a Hono API for writes and an SSE firehose, and a worker that claimed tickets, cut a git worktree per ticket, ran one Claude Agent SDK `query()` per phase (planner → builder → reviewer, each with zod envelopes and mechanical gates), and opened PRs with provenance trailers. Later it grew a second harness (pi on OpenCode Go), human questions parked inside phases, a review/fix loop, a circuit breaker, and a policy system.

The thin slice worked and worked fast: M0 shipped in two days and its first builder runs succeeded in 3–20 minutes for $0.74–$5.21 each. Then M1 tried to add five features at once *through* the factory, and the numbers went the other way: **94 runs, 19 successes (20 %), $378 estimated spend, 382 M tokens**, of which the reviewer phase alone accounted for **45 failures, 1 success and $193 (51 % of all spend)**. 30 runs (32 %) died on Claude plan `usage_limit`; 11 on `base_conflict`; a claim-guard bug spun **12,357 runs in two hours**.

"Slow" was not the local machine's git or gates (worktree + gates + commit total ≈ 5 s per run). It was: (1) model wall-clock — a successful builder phase is a median 14 min / 81 turns, a planner 44 min / 40 turns; (2) the human — 152 `AskUserQuestion` rounds inside 12 planner phases, ~15 h of cumulative wait, while the worker sat blocked; (3) plan windows and laptop sleep killing runs (`exit 143` ×4, "computer went to sleep" ×2, postgres restart ×1); (4) retry churn — FAC-13 took 26 runs for 3 successes.

"Overly complicated" is quantifiable: 5 long-running processes on 5 ports and 3 Postgres databases; 18 tables / 163 columns; 8 gates, 4 envelope types, 13 event types, 11 status kinds, 2 harnesses, 2 providers, 3 worktree modes, 3 runaway limits, ~45 LESSONS entries of which 11 are about Zero alone.

## 2. What it was

### Architecture (as of `m1`)

| Process | Role | Port |
|---|---|---|
| Postgres 17 (docker, `wal_level=logical`) | tickets, runs, events, transcripts; also job queue and NOTIFY bus; separate `zero_cvr` / `zero_change` DBs | 6432 |
| zero-cache | Zero sync engine; logical replication of 12 tables; named queries served by the API | 4849 + 4850 |
| `apps/api` (Hono) | `/zero/query`, design create/approve/reject, question answers, `/api/runs/:id/stream` SSE, ticket lookup | 4848 |
| `apps/web` (Vite + React + Zero client) | board (j/k), ticket page, design tab (sandboxed `review_html`), run trace swim lanes, inbox | 5173 |
| `apps/worker` | claim → worktree → phases → gates → commit/PR; reaper; breaker | — |

Plus a `claude` subprocess per phase (Agent SDK) or an in-process pi session. "Bring the whole thing up in four terminals" (`CLAUDE.md`).

Code size on `m1` (non-test): worker 3,005 lines, web + api 2,225, schema 818; 17 test files. Justfile: 21 recipes.

### Data model

`packages/schema/sql/001_init.sql` (main) + `002_questions`, `003_project_key` (51-line plpgsql key derivation), `004_harness`, `005_ticket_deps_and_project_design`, `006_notification` (on `fac-11`), `006_payment` (on `fac-22`).

Tables (columns): project 10, status 7, ticket 14, comment 5, label 4, ticket_label 2, ticket_dep 3, design 11, project_design 5, run 20, phase 23, event 10, envelope 9, gate 7, question 13, transcript_entry 7, notification 11, _migration 2.

Spine: **Ticket → Run → Phase → Event**, with Envelope + Gate per phase attempt and Question per human round. Status is a row (`status_id`) with a fixed `kind` (11 kinds) and per-project name/colour; agents trigger on kind via `TRIGGER_STAGES` (`packages/schema/src/trigger.ts`).

### The loop

1. `claim()` (`apps/worker/src/db.ts`): `SELECT … FOR UPDATE SKIP LOCKED` on tickets in a trigger kind, 2-minute lease, 20 s heartbeat, ticket moved to the working kind.
2. `acquireWorktree` (`sequencer.ts`): `syncBase` → fresh `git worktree add -B` under `.goblin/worktrees/`, or attach to an existing branch, commit leftover work, merge base in, move the pinned `baseSha`; `base_conflict` fails the run.
3. Phases in order, handing the previous envelope forward. Per-ticket dollar cap checked before each phase (and, on `fac-24`, before each agent call).
4. Agent phase (`phase.ts`): one `query()` with model/effort/tools/maxTurns/maxBudgetUsd, `outputFormat: json_schema` from zod, PreToolUse guard hook + tool_call events, `sessionStore` mirrored to `transcript_entry`, `canUseTool` intercepting `AskUserQuestion` to park the phase on `question` rows (polled every 2 s). Cost from `result.modelUsage`.
5. Gates run on the parsed envelope; failures re-prompt the same session ("correction, not restart"), `gateRetries + 1` attempts.
6. Code phases: `save_design`, `commit_and_pr` (fold to one commit with `Factory-Ticket/Run/Phase/Design` trailers, `gh pr create`), `push_fixes`.
7. Ticket moves to the trigger's success kind; worktree removed on success, kept on failure.

Pipelines (`pipelines.ts`): `ready_for_design → [planner, save_design]` (no worktree); `ready_for_dev → [builder, commit_and_pr]` (fresh); `in_review → [reviewer, push_fixes]` (attached; the reviewer phase internally spawns `builder_fix_N` phases up to `maxFixLoops`).

### Phases, gates, envelopes

| Phase | Tools | Envelope | Gates |
|---|---|---|---|
| planner | Read/Glob/Grep/Agent/AskUserQuestion/Web* | `PlanOutput {design_markdown, review_html, open_questions}` | `design_complete` (sections + EARS), `review_readable`, `verdict_consistent` |
| builder | + Write/Edit/Bash | `BuildOutput {changed_files, commit_message, evidence[], deviations[], handoff}` | `tests_pass`, `diff_matches_claims` |
| reviewer | read-only + Agent | `ReviewOutput {lenses_run, findings[{lens, requirement, met, evidence, severity, refuted}], verdict}` | `review_verdict_consistent`, `lens_coverage`, `refutation_attempted` |

Gate results are `{item, ok, note}[]`, never a bool (`packages/schema/src/types.ts`).

### Skills / prompts

- `packages/skills/plan/SKILL.md` (118 lines) + `design-template.md` — the terminal `/plan` grill-me skill (frontier rounds with recommended answers, three-perspective critique, writes to the API, never the repo).
- `apps/worker/prompts/{planner,builder,reviewer}.md` (111 / 42 / 75 lines) — system-prompt appends; the reviewer prompt is the "one blind subagent per lens, then a refuter" design.

### Policy

`policy` zod (`types.ts`): preset, gates (designApproval/prApproval/autoMerge/deploy), review (lenses/maxFixLoops/blockOn), models (4 tiers × {harness, model, effort, budgetUsd, maxTurns}), design, tools (builderBash, protectedPaths), commands (6), budgets (4). `fac-12` added `policyParse`/`policyResolve` and three presets merged over defaults.

## 3. What worked (evidence)

- **The thin slice.** First six runs (FAC-1..4, 20 Aug): 4 successes, 195–1,168 s, $0.74–$5.21, 8–90 k output tokens. PR #1 and #2 merged the same day. M0 really did ship in two days.
- **Claim/lease/heartbeat/reaper.** Only 1 `stalled` and 1 `double_claim_cleanup` in 94 runs; laptop sleeps were recovered by the sweep.
- **Mechanical gates were cheap and true.** `tests_pass` 23/23; `lens_coverage` 19/20; `design_complete` caught 2 real template omissions. Gate wall-clock is negligible: `bash: pnpm typecheck` 5–8 s avg; all 4,238 bash tool calls total 86 min across the whole week.
- **Envelope → gate → correction-in-session.** `diff_matches_claims` failed 6 times on attempt 1 and passed 4/4 on attempt 2; `design_complete` 2 fails on attempt 1, 10/10 on attempts 2–3. The re-prompt works when the gate measures something real.
- **Observability.** 10,576 events (7,622 tool_calls with `duration_ms`, 1,390 messages, 120 gate_pass / 30 gate_fail, 152 question / 148 answer); every run's cost and tokens; per-subagent lens timings (correctness lens avg 27 s, max 6.7 min). Diagnosing every incident in LESSONS.md was done from this table.
- **Human questions on the board.** 152 questions across 12 planner phases, 100 % answered, median wait 4 min. `canUseTool` + poll is a two-file mechanism (`questions.ts`, `ask.ts`) and it never lost an answer; answered questions were fed into the next planner's prompt so a dead run did not re-ask.
- **Provenance.** Every factory commit carries trailers; PR bodies carry evidence + handoff; merged PRs #4, #5, #6 were built by the factory.
- **pi adapter.** 228 lines (`apps/worker/src/harness/pi.ts`); first probe returned a valid envelope, a tool call and a cost line ($0.0106); the pi builder succeeded once ($2.28, 1,128 s) and the pi reviewer once ($0.71, 900 s — the only reviewer success in the DB). The phase contract was genuinely harness-neutral.
- **Halt reasons + breaker.** After 22 Aug, budget/usage/turn limits stopped appearing as `worker_error`; the rate breaker (12 runs / 10 min) exists because of the 12,357-run loop and would have stopped it in ~10 minutes.

## 4. What was slow (root causes, quantified)

Wall-clock split of the 19 successful runs: agent phases = 99–100 % of run time; worktree + gates + commit + PR = 0–5 s. **Local git was not the problem.**

1. **Model wall-clock per phase.** Successful phases (median / p90 / turns / cost): builder 833 s / 1,158 s / 81 / $4.30; builder_fix ≈ 500–600 s / 50–56 turns; planner 2,663 s / 3,758 s / 40 / $9.79; reviewer (once) 900 s / 27. A builder averaged 86 tool calls, a planner 93. Sonnet xhigh at 80 turns is 14 minutes whatever machine hosts it.
2. **Waiting on the human inside the phase.** 152 questions, 12.7 per planner phase, avg 6 min / max 31 min each, **896 min total** blocked inside phases — more than all successful planner compute combined (~321 min). The worker held the claim the whole time (FAC-23 "Waiting for a human should not occupy a worker" was ticketed but not shipped).
3. **Plan windows.** 30 runs `usage_limit` ("You've hit your session limit · resets 12:20am"); 26 of them the reviewer. Nine reviewer runs died consecutively on 23 Aug at 1–4 s each; twelve more on 26 Aug 05:09–05:12. Switching every tier to OpenCode Go on 23 Aug hit `429 GoUsageLimitError` two days later and everything moved back. Subscription windows, not compute, set the cadence.
4. **Retry and branch churn.** Per ticket: FAC-13 26 runs / 3 successes / $54; FAC-12 17 / 2 / $74; FAC-11 13 / 2 / $65; FAC-10 11 / 3 / $57 / 22.3 h. 11 runs failed instantly on `base_conflict` (long-lived branches vs a moving `m1` base; `default_branch` was temporarily set to `m1`). The fresh-vs-attach-vs-resume worktree logic, base catch-up, and pinned `baseSha` exist to serve retries that a fresh clone in a sandbox would not need.
5. **The laptop.** `Claude Code process exited with code 143` ×4, "Your computer went to sleep mid-response" ×2, "worker gone: postgres restart", one `stalled`. Blueprint mitigation was `caffeinate`; it did not hold.
6. **The reviewer design.** 45 fails / 1 success; $192.70. Causes: usage_limit 26, worker_error 7, budget_exhausted 3 ($33), fix_gates_failed 3 ($33), no_envelope 2 ($39), gates_failed 1 ($12). Its own gates rejected it: `refutation_attempted` 3 pass / 10 fail (77 % fail), `verdict_consistent` 7 / 10 (59 % fail); 14 of 34 ReviewOutput envelopes invalid. Each attempt cost a 4-lens subagent fan-out (avg 16–27 s per lens, up to 6.7 min) plus refuters. The biggest single run, `run_fy6006wx9a` (FAC-22), spent $49.88, 897 events and 1 h 49 m before dying on usage_limit.
7. **Structured output.** 29 "invalid envelope: expected object, received null" — the SDK returned no `structured_output` and the text fallback found no JSON. PlanOutput 14/31 invalid, ReviewOutput 14/34. Each costs a full re-prompt attempt.
8. **The guard.** 66 `permission_breach` events; the lesson on 22 Aug measured 19 of 29 as false positives (regex literals, `/**`, `git -C` into its own worktree). A denied reviewer "gave up and wrote its findings as prose", failing the envelope — a false denial reads as an agent that cannot follow instructions.

Zero itself was not a run-time cost (event/transcript tables were excluded from replication by design) but it was a large *development* cost — see below.

## 5. What was overly complicated

- **Five processes, five ports, three databases** for one user and three views. `just ps`/`just stop` exist because the process zoo needed a supervisor; LESSONS records killing a live run because `pgrep` matched the wrong tsx child.
- **Zero.** 11 of ~45 LESSONS entries: no `.unique()`, `json<T>` typing, `--admin-password`, replica cwd, client ZQL silently syncs zero rows, `X-Api-Key`, permissions gone, `useQuery` memoization, 60 s disconnect with no reconnect, IndexedDB tab hygiene, "wedged client opens no socket at all". Reads went through Zero, writes through REST, live events through NOTIFY→SSE, answers through polling — four transports for one board. A single REST+SSE (or plain polling) app would have covered the three views.
- **Schema breadth.** 18 tables / 163 columns; `phase` has 23 columns, `run` 20, `question` 13. `transcript_entry` holds 80 MB nobody reads back except `resume` (which the SDK could do from disk). `notification`, `project_design`, `ticket_dep`, `label`, `comment` were built ahead of a use. `003_project_key` is 51 lines of plpgsql to derive `FAC`.
- **Policy before it was data.** ~40-field zod object, 4 tiers, 3 presets, a parse/resolve layer (FAC-12, 17 runs, $74) — while the only project ever run was the factory itself.
- **Worktree lifecycle.** `fresh | attached | none`, `hasBranchWork` resume, leftover-work commits, `mergeBaseInto`, moving `baseSha`, fold-and-recommit with trailers, `.git/info/exclude` management, guard on `git -C`. At least 9 LESSONS entries and 11 `base_conflict` runs came from this; `git.ts` is 234 lines.
- **Two harnesses × two credential lanes** (claude-code with Max token + API-key failover; pi with OpenCode Go and Zen) with a guard ported to both (`file_path` vs `path` hole), tool-name mapping, and per-tier lane switching flipped twice in three days.
- **Gate inflation.** 8 gates; the three that judge prose discipline (`verdict_consistent`, `refutation_attempted`, `review_readable`) failed 21 of 47 checks and mostly re-prompted an agent to restate, not to fix.
- **Three runaway limits + breaker + backoff + reaper + lease**, each added after an incident, each correct, together ~250 lines of failure-mode code around a 60-line happy path.
- **Dogfooding too early.** M1 kickoff: "Default to running work through the factory itself." Result: 6 leftover worktrees, 6 `goblin/fac-*` branches, `main` 73 commits behind `m1`, `default_branch` hack, DECISIONS/LESSONS `merge=union`, and each machinery change needing a chicken-and-egg exception.
- **Research and spec mass.** 8,067 lines of research and a blueprint with 7 agents (Conductor, Scout, Librarian, Deployer …) of which 3 were ever built.

## 6. Salvageable pieces

Paths on `m1` unless noted (`/Users/roze/.herdr/worktrees/factory/m1/...`); `main` copies under `/Users/roze/dev/factory/...`.

**Contracts (copy nearly verbatim)**
- `packages/schema/src/types.ts` — `envelopeBase`, `buildOutput`, `planOutput`, `reviewOutput`/`finding`, `blockingFindings`, `gateCheck`/`report`/`violations`, `envelopeJsonSchema`, `STATUS_KINDS`, `EVENT_TYPES`. The 190 lines that were right the whole time.
- `packages/schema/src/trigger.ts` — `TRIGGER_STAGES` (trigger → working → success) as the one place the state machine lives.
- `packages/schema/sql/001_init.sql` — the `run` / `phase` / `event` / `gate` / `question` shapes (trim columns), the `notify_event` trigger, and the "live tail and history are the same cursor query" idea.

**Worker mechanics**
- `apps/worker/src/db.ts` `claim()` — `FOR UPDATE SKIP LOCKED` + lease + heartbeat.
- `apps/worker/src/halt.ts` — named halt reasons (`budget_exhausted`, `turn_limit`, `usage_limit`, `no_credit`) and "never retry these".
- `apps/worker/src/breaker.ts` — rate breaker + quadratic backoff on instant failures.
- `apps/worker/src/reaper.ts` — stalled-run sweep with "3 then leave for a human".
- `apps/worker/src/git.ts` `commitAll` — provenance trailers; `changedFiles` against a pinned sha.
- `apps/worker/src/gates.ts` — `tests_pass`, `diff_matches_claims`, `design_complete` (the mechanical ones).
- `apps/worker/src/questions.ts` + `ask.ts` — question rows + poll; harness-agnostic.
- `apps/worker/src/harness/pi.ts` — the pi session/event/usage mapping (`tool_execution_start/end`, `turn_end.message.usage`, `ModelRuntime`, guard as `tool_call` extension). This is the v1 runtime's starting point.
- `apps/worker/src/phase.ts` — hooks→events pattern and `modelUsage` cost accounting, for reference if any Claude-SDK phase survives.

**Prompts / skills**
- `packages/skills/plan/SKILL.md`, `design-template.md` — grill-me planner; keep as a terminal skill, not a parked worker phase.
- `apps/worker/prompts/builder.md`, `reviewer.md`, `planner.md`.

**API / UI**
- `apps/api/src/index.ts` `/api/runs/:id/stream` + `notify.ts` — cursor SSE with NOTIFY wake-up and 15 s ping; single LISTEN with backoff.
- `apps/web/src/inbox.ts` (+ test) — the "everything waiting on me" derivation (open questions, pending approvals, stuck candidates).
- `apps/web/src/pages/Trace.tsx` — swim lanes per phase; `boardNav.ts` j/k.
- `packages/schema/src/html.ts` `unwrapHtmlFragment` and the sandboxed-iframe `review_html` rule.

**Knowledge**
- `docs/LESSONS.md` (m1, ~45 entries) and `docs/DECISIONS.md` — the most valuable artefact of the week.
- `docs/research/04-claude-runtime-observability.md`, `06-methodology.md` Part B (design template, lens briefs, builder DoD).
- The DB: `pg_dump` `factory` before touching the container — 94 runs of ground truth for calibrating v1 budgets (builder ≈ $4–5 / 14 min; planner ≈ $10 / 45 min; reviewer fan-out ≈ $10–50 and unbounded).

## 7. Lessons for v1 (pi runtime, cloud sandboxes, small owned tracker, one provider, tracer bullet first)

1. **Tracer bullet means one ticket → one pi session in a sandbox → one PR, with a text file as the tracker if necessary.** M0 in v0 was two days and 4/6 successes; everything after was M1 trying to land planner-phase, questions, reviewer loop, inbox, import, and pi at once (94 runs, 20 %). Do not add a second phase until the first has a >80 % success rate over ten real tickets.
2. **One process + one store.** Drop Zero, the SSE bus, and the poll loop; a tracker with three views needs REST + a 2 s poll (or one SSE endpoint). Target ≈ 6 tables (project, ticket, run, phase, event, question) and ≈ 50 columns; add `gate`/`envelope` rows only when a gate exists.
3. **Sandboxes replace ~600 lines of local-isolation code.** Fresh clone per run removes fresh/attached/resume, base catch-up, `.goblin` exclusion, the `git -C` heuristic and the 66-breach path guard; the sandbox boundary *is* the guard. Laptop sleep (7 run deaths) disappears. Keep only: pinned base sha, trailers, one commit per phase.
4. **One metered provider, no windows.** 32 % of runs died on subscription windows across two vendors; a dollar cap is only a leash when the lane cannot run dry mid-phase. Budget from measured numbers: ~$5 per builder ticket, ~$10 per planner interview; v0 burned $378 in a week mostly on failed reviews.
5. **Planning is a conversation, not a phase.** 15 h of human wait sat inside worker phases. Keep `/plan` in the terminal (or a chat), write the design to the tracker, and let the worker only ever claim tickets that need no human until the PR. If a builder must ask, end the run and re-queue on answer (FAC-23's design) rather than park.
6. **No reviewer loop in v1.** 1 success in 46 attempts and half the spend. When review returns, make it a single non-blocking pass that posts findings to the PR; drop `refutation_attempted`/`verdict_consistent`-style prose gates. Gates should be things a shell can verify: tests, typecheck, diff ⊆ claims, protected paths.
7. **Parse JSON out of text from day one.** pi has no structured-output mode and the SDK's mode returned null 29 times anyway. One envelope shape (`status, summary, changed_files, evidence, handoff`), fenced JSON at the end, `tryJson` fallback, one retry.
8. **Never auto-retry; humans re-arm.** The 12,357-run loop, `base_conflict` ×11 and the 26-run FAC-13 saga all came from automatic re-claims. A failed run leaves the ticket where it is with the reason on the card; dragging it back is the retry. Keep the rate breaker as a backstop.
9. **Policy is a 10-line object until a second project exists.** `model`, `budgetUsd`, `maxTurns`, `testCommand`, `protectedPaths`. Presets, lanes, tiers and parse/resolve were $74 and 17 runs for zero projects that needed them.
10. **Build the factory by hand until the loop is boring.** Dogfooding a half-built factory on itself created the branch/base/worktree mess and the chicken-and-egg exceptions. Onboard the factory as its own project only after a non-factory repo has gone through cleanly.
11. **Keep the observability spine, shrink the write path.** `run/phase/event` with cost per phase and `{item, ok, note}` gate evidence answered every question this post-mortem asked; but write events in batches and skip the transcript mirror (80 MB unread).
12. **Write LESSONS as you go.** It is the only reason this document has numbers to attach to feelings; carry `docs/LESSONS.md` and `docs/DECISIONS.md` forward as files, union-merged.
