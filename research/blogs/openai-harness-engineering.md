# OpenAI "Harness Engineering" + Symphony

- **URL:** https://openai.com/index/harness-engineering/ (post, Feb 2026; returns 403 to fetchers — mirrored/summarized at https://alexlavaee.me/blog/openai-agent-first-codebase-learnings/ and https://www.zenml.io/llmops-database/harness-engineering-building-software-where-humans-steer-and-agents-execute)
- **Symphony:** announcement https://openai.com/index/open-source-codex-orchestration-symphony/ (2026-04-28, also 403); repo https://github.com/openai/symphony (SPEC.md is the real doc); talk "Extreme Harness Engineering for Token Billionaires" (Latent Space, Ryan Lopopolo) https://www.latent.space/p/harness-eng ; AI Engineer talk https://www.youtube.com/watch?v=am_oeAoUhew
- **Corpus:** https://github.com/lopopolo/harness-engineering (Lopopolo's personal "theses + playbooks" corpus, AGENTS.md = 103 lines of routing)
- **Type:** blog + factory (orchestrator spec)
- **Author/Org:** Ryan Lopopolo, OpenAI Frontier team
- **Researched:** 2026-08-26
- **Status/maturity:** Symphony repo 26.9k stars / 2.8k forks, Apache-2.0, "low-key engineering preview for trusted environments"; Elixir reference impl; OpenAI says it will not maintain it as a product.

## One-paragraph summary

A ~3-to-7-person OpenAI team built a >1M-LOC, ~750-package product over 5–9 months with 0% human-written code and no human pre-merge review, by treating the *environment* (repo layout, docs, linters, observability, CI) as the thing engineers build and the agent (Codex) as the thing that executes. "Humans steer. Agents execute." Symphony is the orchestrator they open-sourced afterward: a polling loop that turns a Linear board into a state machine, gives each issue its own workspace, runs a Codex app-server session with a turn budget, retries with backoff, and posts PRs for human (or agent) review. Dex Horthy's WSFF article cites this as the poster-child of "harness engineering" and argues it is still not enough without owning weights.

## Core ideas / thesis

- **Agent legibility over human legibility.** Software is written "for the model as much as for the engineer." "Code in the file system is text, which means it's effectively prompts given to coding agents" — so uniformity (one ORM, one language, one way) is a prompt-quality decision.
- **Repository as the only truth.** "Anything it can't access in-context while running effectively doesn't exist." Design docs, exec plans, product specs, tech-debt tracker all live in `docs/`, versioned.
- **Context is scarce; progressive disclosure.** AGENTS.md is "~100 lines, pointers only" — a table of contents, not an encyclopedia. "A giant instruction file crowds out the task, the code, and the relevant docs."
- **Failures trigger capability-building, not manual fixes.** When the agent can't, "you always pop open the task... and build smaller building blocks" (Lopopolo, 00:04:00).
- **Synchronous human attention is the only scarce resource.** "The only fundamentally scarce thing is the synchronous human attention of my team." Symphony exists to take humans out of the synchronous loop.
- **"Don't put the agent in a box. Give the agent full accessibility over its domain."** (00:42:44)

## Architecture & mechanics

**Repo layout (from the post):**
```
AGENTS.md            (~100 lines, pointers only)
ARCHITECTURE.md
docs/
  design-docs/
  exec-plans/ (active/, completed/, tech-debt-tracker.md)
  product-specs/
  references/
  DESIGN.md  FRONTEND.md  PLANS.md  SECURITY.md
```
Talk adds: `spec.md`, `agent.md`, `core_beliefs.md` (team/customers/vision), `tech_tracker.md` + quality scores, and 5–10 core skills (down from "thousands" experimented with early on). Skills have built-in observability.

**Layered architecture enforced mechanically.** Dependency direction `Types -> Config -> Repo -> Service -> Runtime -> UI`; cross-cutting concerns only via `Providers`. Enforced by agent-written custom ESLint rules, structural tests, and CI. Lint error messages are written *for the agent*: "Error: Service layer cannot import from UI layer. Move this logic to a Provider or restructure the dependency." Other lints: every `fetch` has retries/timeouts, package privacy/dependency edges, Zod-schema dedup, shared-utility usage, 350-line file max.

**Prompt-injection surfaces (their term for where humans steer):** direct prompts, lint error messages, review-agent PR comments, test-agent SDKs, docs/ADRs, skills.

**Feedback loops for the agent:** Chrome DevTools Protocol access; isolated app instance per git worktree; DOM snapshots before/after; screenshots for visual regression; local Prometheus/Grafana/Jaeger; logs via LogQL, metrics via PromQL. Single Codex runs ran "for six hours straight, often while the engineers slept." Build inner loop capped at ~1 minute (cycled Make -> Bazel -> Turbo -> NX). Codex 5.3 background shells let the agent kick off builds while reviewing.

**Review:** no human pre-merge review. Agent reviewers with personas (front-end architect, reliability engineer, scalability expert), P0/P2 scaffolding, "instructed to bias toward merging." Post-merge *sampling* review by humans to infer where the team/agent struggles.

**Garbage collection:** initially "Every Friday, where the entire team's job was to identify slop observed during the week" (~20% of the week). Replaced by encoding "golden principles" in the repo and running background Codex tasks on a cadence that scan for drift, update quality scores, and open small refactor PRs "reviewable in under a minute." "Human taste is captured once, then enforced continuously on every line of code."

**Skill distillation:** agents introspect their own logs daily to improve skills.

**Ghost library:** ship software as *specs* not source: reference repo -> auto-generated spec -> new repo spawns Codex to implement -> review agent compares implementation to spec -> iterate. (Same idea as StrongDM's Attractor nlspec.)

**Symphony (SPEC.md) — the orchestrator:**
- Components: Workflow Loader (`WORKFLOW.md` YAML front matter + Liquid prompt body), Config, Issue Tracker Adapter (`fetch_issues_by_states`, `fetch_issues_by_ids`), Orchestrator (poll cadence, in-memory state, dispatch, retry queue, metrics), Workspace Manager, Agent Runner (spawns `codex app-server`), optional HTTP Status Surface (`/api/v1/state`, `/api/v1/<issue>`, `POST /api/v1/refresh`), structured logging.
- Poll every `polling.interval_ms` (30 s): fetch issues in `active_states`, sort by priority + created, dispatch while slots free. Eligible = has id/identifier/title/state, active not terminal, `dispatchable`, has all `required_labels`, not claimed, under `max_concurrent_agents` (10) and per-state caps.
- Issue states: `Unclaimed -> Claimed -> Running -> RetryQueued -> Released`. Attempt lifecycle: `PreparingWorkspace -> BuildingPrompt -> LaunchingAgentProcess -> InitializingSession -> StreamingTurn -> Finishing -> {Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation}`.
- One workspace per issue (reused across attempts), path = sanitized identifier + hash; hooks `after_create` (fatal on failure), `before_run`, `after_run`, `before_remove`, 60 s timeout each. Invariant: agent cwd must equal workspace path, inside `workspace.root`.
- Turn budget `agent.max_turns` = 20 on the same live thread; after each turn re-read the issue; continue with "continuation guidance" if still active, else exit. Stall detection `stall_timeout_ms` 5 min; turn timeout 1 h.
- Retries: clean exit -> 1 s; failure -> `min(10000 * 2^(attempt-1), 300000)` ms.
- Reconciliation each tick: stalled runs killed; issue moved to terminal -> kill + delete workspace. Restart recovery is tracker-driven (nothing survives restart; re-poll).
- Provider-native tools execute host-side with adapter auth; "tracker credentials are not inherited by the child process."
- `WORKFLOW.md` hot-reloads; invalid reload keeps last-known-good.
- Rework model from the talk: reviewer says merge or rework; on rework "the elixir service will completely trash the entire work tree and PR and start it again from scratch."

## Workflow: end to end

1. Human (or agent) files a Linear issue; adds required label; moves to an active state (backlog/todo). One issue may spawn multiple PRs across repos or no code at all (investigation).
2. Symphony polls, claims the issue, creates/reuses workspace, runs `after_create` (clone, deps), renders prompt from `WORKFLOW.md` with `issue` + `attempt`.
3. Codex app-server session runs up to 20 turns; the agent reads AGENTS.md -> docs/, writes an exec plan under `docs/exec-plans/active/`, implements, runs lints/structural tests/build (<1 min), drives the app via CDP, checks logs/metrics.
4. Agent opens PR with "proof of work: CI status, PR review feedback, complexity analysis, and walkthrough videos."
5. Agent reviewers (personas) comment; agent fixes; merge (bias to merge). Human sampling review post-merge.
6. Issue -> terminal; workspace removed. GC agents later open drift-fix PRs.
Metrics: 3.5 PRs/eng/day before Symphony -> 5–10 after; ~1,500 PRs / >1M LOC; 1B tokens/day (~$1–3k/day); tokens split ~1/3 planning+docs, 1/3 implementation, 1/3 CI/review; some teams +500% landed PRs in 3 weeks.

## Notable techniques worth stealing

- AGENTS.md as ~100-line router; everything else in `docs/` with an index. Exec plans checked in with progress logs.
- Lint messages that contain the remediation; agent-written lints; structural dependency tests.
- 350-line file cap and layer rules as *backpressure* against slop.
- Scheduled "GC" agent runs against a written set of golden principles, emitting tiny PRs.
- Per-issue reusable workspace + hooks + turn budget + stall timeout + tracker-driven recovery (all in SPEC.md, copyable).
- Rework = throw away worktree and restart, don't patch a bad branch.
- Give the agent the observability stack (logs/metrics/traces) and a browser, not just tests.
- Review agents with explicit personas and severity scaffolding.
- Skill distillation from the agent's own logs.

## Weaknesses / open questions / risks

- Everything depends on Codex app-server; Symphony's `codex.*` section is Codex-specific.
- Team owns the weights ("if you build a harness but you don't own the weights... you'll always be at a disadvantage" — cited by Dex). Results may not transfer.
- $1–3k/day token spend; 750 packages/1M LOC in 5–9 months is a lot of surface area with no human reads — no external audit of maintainability yet.
- Admitted gaps: zero-to-one prototyping, "gnarliest refactorings", merge conflicts, QA artifact validation, agents optimizing locally instead of reusing utilities.
- Symphony has no persistence; restart loses retry timers (by design).

## Fit for our agentic stack (solo, pi, cloud VMs)

- **Adopt:** the docs/ layout and 100-line AGENTS.md router verbatim; exec-plans with progress logs so a resumed pi session can pick up. Write our lints with remediation text. Add a `file > 350 lines` check.
- **Adapt Symphony -> pi:** re-implement SPEC.md's loop in a few hundred lines (TS or Python): poll a tracker (GitHub Issues/Linear, or a `queue/*.md` dir), one VM/worktree per issue, `pi --session-id <issue>` as the app-server equivalent, `max_turns`, stall timeout, exponential backoff, tracker-driven recovery. The hooks map to VM lifecycle (`after_create` = image restore, `before_remove` = harvest branch).
- **Adapt GC:** a nightly pi run with `docs/golden-principles.md` that opens <100-line PRs; solo dev reviews those in a minute each.
- **Adapt review:** two persona review agents (correctness, maintainability) before the solo human sampling-reviews merged PRs; do *not* skip human review yet (see Faros/Dex).
- **Skip:** 1B tokens/day scale; Elixir impl; CDP-based UI verification until a UI exists.

## Related resources mentioned

- https://github.com/openai/symphony/blob/main/SPEC.md — full orchestrator spec (worth its own file)
- https://github.com/lopopolo/harness-engineering — theses/playbooks corpus (tool legibility, proof boundaries, continuous maintenance)
- Latent Space episode https://www.latent.space/p/harness-eng — Ghost Library, skill distillation
- OpenAI Frontier platform (enterprise agent dashboard) — context only

## Key quotes / references

- "Humans steer. Agents execute."
- "Context is a scarce resource. A giant instruction file crowds out the task, the code, and the relevant docs."
- "Anything it can't access in-context while running effectively doesn't exist."
- "Human taste is captured once, then enforced continuously on every line of code."
- "The only fundamentally scarce thing is the synchronous human attention of my team."
- Symphony: "transforms project work into isolated, autonomous implementation runs, allowing teams to manage work instead of supervising coding agents."

## Gaps

- Could not fetch the original openai.com post or the Symphony announcement (403; archive.org blocked). Numbers (5 vs 9 months, 3 vs 7 engineers, $1k vs $2–3k/day) differ between secondary sources; treat as approximate.
- Did not read the Symphony Elixir source or the demo video; did not verify the "walkthrough videos" proof-of-work mechanism.
