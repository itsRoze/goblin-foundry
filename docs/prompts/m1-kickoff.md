# Kickoff: build M1 of Goblin Foundry

You are continuing **Goblin Foundry** (`/Users/roze/dev/factory`). M0 shipped on 2026-08-20: the thin slice works end to end, and the pipeline has already built three of the factory's own tickets to Done (two merged as PRs #1–#2 from `goblin/fac-*` branches). M1 makes the loop complete enough to onboard the first real app.

## Read first
1. `CLAUDE.md` — layout, commands, house rules. Follow it.
2. `docs/plan/factory-blueprint.html` (v1.3) — the spec. Focus: The agents (Planner, Reviewer, Conductor), Status machine, Per-project policy, Roadmap → M1 (which now includes the pi thin slice).
3. `docs/DECISIONS.md` and `docs/LESSONS.md` — what the M0 build decided and what bit it. Do not re-learn these lessons (especially: Zero 1.9 synced queries only, the PreToolUse guard, secret scrubbing, the gate-loop `continue` bug).
4. `git log --oneline` on `m0/thin-slice` for what exists; the schema in `packages/schema/sql/` + `src/types.ts` before touching data.
5. Skim `docs/research/06-methodology.md` Part B §7–8 (planner perspectives, reviewer lenses) when building those agents.

Memory: `~/.claude/projects/-Users-roze-dev-factory/memory/MEMORY.md` and the linked project note.

## State of the world (verified 2026-08-20)
- `just up` / `zero` / `api` / `web` / `work` all function; typecheck and all tests green.
- Statuses, designs, runs, phases, events, gates, envelopes, questions tables exist. Events bypass Zero (SSE); UI reads are named synced queries served at `/zero/query`.
- The worker: lease + heartbeat claims, worktrees with a PreToolUse guard, multi-phase sequencer, gates with evidence, correction-in-session, stalled-run reaper (3 failures → human), provenance trailers, secret-scrubbed subprocess env.
- `/plan` runs in the user's terminal (skill), writes designs to the DB (never committed), moves tickets to Design Review.
- Backlog already contains M1 seed tickets: `tkt_plan` (planner as a phase), `tkt_qs` (questions to the board / answers to the agent), `tkt_pgate` (a design has to earn Design Review), `tkt_6ru5y8svbb` (healthz — two SIGTERM'd runs, fine to retry), `tkt_piharness` (#16 — the pi adapter, pulled forward from M2, see scope item 10).

## How to work in M1 — dogfood first
**Default to running work through the factory itself**: write a ticket, `/plan` it, approve, let the worker build it, review the PR. Fall back to hand-building only when the change is to the very machinery a run depends on (chicken-and-egg) — and say so in `docs/DECISIONS.md`. Every M1 feature below should become one or more tickets on the board.

## M1 scope (in rough order)
1. **Planner as a worker phase** (`tkt_plan` + `tkt_qs`): fires on `ready_for_design`; grill-me rounds become `question` rows; the board shows an **Answer** UI; answers resume the session (`awaiting_input` phase status). Keep `/plan` working as the terminal alternative.
2. **Design quality gate** (`tkt_pgate`) and the **three-perspective pass** (product / engineering / UX subagents critiquing the draft; disagreements become open questions).
3. **`review.html`** — the human-facing interactive design doc: overview, user flows, HTML mockups, high-level changes, open questions; inline annotations create a new design version. Serve it from the design tab.
4. **Reviewer agent**: three lenses to start (correctness/spec-fidelity, tests, maintainability), each an isolated subagent seeing only diff + design + brief; findings side by side; a refuter pass; blocking findings resume the builder (max 3 loops from policy, then Needs You); then `ready_to_merge` with the PR-approval gate from policy.
5. **Approvals inbox** — one page listing every open question and pending approval across projects; **ntfy** push on anything entering it.
6. **Per-project policy**: `factory.policy.yaml` (or a `policy` column) with the serious/standard/vibe presets from the blueprint; the hard-coded standard preset becomes data.
7. **smriti import**: one-shot script — `~/.smriti/factory.db` (`repositories`, `projects`, `tickets`, `ticket_deps`, `documents`) → factory projects/tickets/deps/designs. Subway Reader arrives with its 17-ticket DAG. Idempotent; dry-run flag; report what it skipped.
8. **Onboard Subway Reader** (`~/dev/subway-reader`, empty git init): seed its project + policy (standard; Android QA), then run its entry ticket — #40, the Gradle/Compose scaffold that puts an APK on the Boox — through the full loop. Builder verify = `gradle` build + Android emulator evidence (adb screencap) where feasible; on-device install stays manual for now.
9. **Conductor v0** (stretch, or slip to M2): a resumable per-project session with tools to read the board and propose ticket/dependency changes; terminal-only is fine.
10. **pi harness adapter — thin slice** (`tkt_piharness` #16, pulled forward from M2): a `harness` field on the phase (`claude-code | pi`) and a `PiPhaseRunner` ([earendil-works/pi](https://github.com/earendil-works/pi), SDK/JSON mode) behind the unchanged phase contract — envelope in/out, events, gates. Default provider: **OpenCode Go** (`OPENCODE_API_KEY` — pi ships the `opencode` provider natively; $10/mo, $12 per 5-hour window, Kimi K3 / DeepSeek V4 / GLM / Qwen). Start the A/B: cheap phases + vibe-policy builders on Go, planner and refuter on Claude; cost/phase, tokens, turns, and gate pass rate per harness on the dashboard. *Why now: Max-plan 5-hour limits keep halting development; Go moves the bulk burn to a $10 lane with no OAuth ToS risk.* The guard-as-pi-extension and JSONL session mirror stay in M2.

**Done when:** a real Subway Reader ticket ships through plan → questions → approve → build → review → merge with the user approving exactly twice (design, PR), notified by ntfy on their phone — the M1 machinery itself was mostly built by the factory, and at least one phase ran through pi on OpenCode Go with its cost on the dashboard.

## Out of scope for M1
Deployer, librarian, scout, MCP server, mobile web polish, cloud hosting, OTel export, prompt lineage, Codex adapter, and pi's deep half (guard as a pi TS extension, JSONL session mirror, Codex-as-refuter — M2).

## Working agreements
Unchanged from M0 (see `docs/prompts/m0-kickoff.md` §Working agreements), plus:
- Branch `m1/<slug>` per hand-built change; factory-built work keeps its `goblin/fac-*` branches.
- Append to `docs/DECISIONS.md` / `docs/LESSONS.md` as you go; update `CLAUDE.md` when commands change.
- Anything pulled forward or pushed out of this scope: one line in DECISIONS with why.
