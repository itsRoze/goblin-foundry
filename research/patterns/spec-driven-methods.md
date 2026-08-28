# Spec-driven agent methodologies: GSD, BMAD-METHOD, GitHub Spec-Kit (compared)

- **URLs:** GSD: https://github.com/gsd-build/get-shit-done (archived 2026-06-26) → https://github.com/open-gsd/gsd-core (`npx @opengsd/gsd-core@latest`; docs https://www.opengsd.net/docs/v1/commands) · BMAD: https://github.com/bmad-code-org/BMAD-METHOD (docs https://docs.bmad-method.org/) + https://github.com/bmad-code-org/bmad-loop · Spec-Kit: https://github.com/github/spec-kit (`spec-driven.md`)
- **Type:** skills/agents (process frameworks installed as slash commands/skills into a coding agent)
- **Author/Org:** GSD — "TÂCHES" (original), now Open GSD community · BMAD — Brian Madison / BMad Code LLC · Spec-Kit — GitHub (Den Delimarsky, John Lam; lead maintainer Manfred Riem)
- **Researched:** 2026-08-26
- **Status/maturity:**
  - get-shit-done 64.6k stars (archived); gsd-core 8,756 stars, MIT, default branch `next`, push 2026-08-26, v1.7.0; 80+ commands across Claude Code, Codex, OpenCode, Cursor, Copilot, Kimi, Antigravity, Kilo, Windsurf.
  - BMAD-METHOD 52.3k stars, 6k forks, MIT (trademarked name), push 2026-08-26, v6; Node 20.12+ / Python 3.10+ / uv; `npx bmad-method install`. bmad-loop: 104 stars, MIT, "early open beta", Python 3.11+, tmux.
  - spec-kit 131.7k stars, 11.8k forks, MIT, v1.0.0 (2026-08-21, "it is now just a number"), Python/uv CLI `specify`, 30+ agent integrations.

## One-paragraph summary

All three answer the same question — how do you keep an agent from "turning unstated assumptions into code" (BMAD) — with the same move: force a chain of reviewed markdown artifacts (principles → requirements → technical plan → task list) before implementation, and make each downstream artifact derive from the one above. They differ in *who* executes and *how autonomous* the implementation phase is. **Spec-Kit** is the leanest: a CLI that scaffolds `.specify/` templates and a fixed command sequence (`/speckit.constitution → specify → clarify → plan → tasks → analyze → implement → converge`) producing `specs/NNN-feature/{spec,plan,tasks}.md`; the agent implements `tasks.md` in one session and `/speckit.converge` re-audits until "Converged." **BMAD** is the most role-heavy: seven named agents (Analyst, PM, Architect, SM, Dev, TEA, UX) across Analysis → Planning → Solutioning → Implementation, with `sprint-status.yaml` as the ledger and per-story fresh-chat cycles (`create-story → dev-story → code-review`), plus **bmad-loop**, a deterministic Python "ralph-loop orchestrator" that drives stories through dev → verify → review → verify → commit in tmux with hooks as the completion signal. **GSD** is the most context-engineered: every phase's heavy work runs in fresh subagents, state lives in `.planning/` (`PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, per-phase `CONTEXT/PLAN/SUMMARY/VERIFICATION.md`), plans are executed in dependency-ordered *waves* of parallel executors each with a clean 200k context, verification is "disk-strict" (a phase is complete only if `*-VERIFICATION.md` exists), and `/gsd-autonomous` runs all remaining phases hands-free with checkpoints only for one-way doors.

## Core ideas / thesis

| | Spec-Kit | BMAD-METHOD | GSD (gsd-core) |
|---|---|---|---|
| Stance | "Specifications don't serve code—code serves specifications." Specs are executable; code is regenerated output. | "Agile AI-Driven Development": keep decisions explicit, "process sizes itself to the work"; agents are personas you converse with. | Solve **context rot**: "running all heavy research, planning, and execution work in fresh-context subagents while keeping your main session lean." |
| Unit of work | feature (`specs/NNN-feature/`) on its own branch | epic → story (`sprint-status.yaml`) | milestone → phase → plan → task (waves) |
| Autonomy | one `/speckit.implement` session; human runs each command | interactive by default; `bmad-loop` / `bmad-autonomous-development` for unattended sprints | `/gsd-autonomous` end-to-end; `--auto` on every command |
| Verification | `/speckit.analyze` (cross-artifact consistency), `/speckit.converge`, `/speckit.checklist` | `bmad-code-review`, adversarial review skills, TEA test architect; bmad-loop "trust nothing, verify everything" on disk artifacts | `/gsd-verify-work` UAT with coverage-aware routing; "honest verifier" abstains rather than silently passes; `/gsd-code-review --depth` |
| Extensibility | extensions / presets / bundles; `.specify/templates/overrides/` | modules (Builder, Loop, Game Dev, Test Architect, Creative), web bundles for Gemini/ChatGPT | capabilities system, ADRs, `/gsd-surface` skill clusters, `gsd-tools.cjs` |
| Runtimes | 30+ (Copilot first-class) | Claude, Codex, Gemini, Copilot, Antigravity, OpenCode | 10+ (Claude first-class; `effort: max/low` frontmatter) |

## Architecture & mechanics

### Spec-Kit
```
.specify/
├── templates/            # spec, plan, tasks, constitution, checklist templates
├── presets/templates/    # preset overrides
├── extensions/templates/
└── templates/overrides/  # project-local (highest priority)
specs/NNN-feature/
├── spec.md               # requirements + user stories + acceptance scenarios (what/why, no stack)
├── plan.md               # stack + architecture, constitution compliance
├── research.md, data-model.md, contracts/, quickstart.md
└── tasks.md              # derived from plan; independent tasks marked [P]
```
Commands: `/speckit.constitution` (once) → `/speckit.specify "<what>"` (auto-numbers, creates branch `003-chat-system`, fills template) → `/speckit.clarify` (resolve underspecified areas) → `/speckit.plan "<stack>"` → `/speckit.tasks` (contracts/entities/scenarios → tasks; `[P]` parallel groups) → `/speckit.analyze` → `/speckit.implement` → `/speckit.checklist` → `/speckit.converge` ("Assess codebase against specs/plans/tasks"; repeat implement/converge until Converged). Opt-in extensions: `bug` (`/speckit-bug-assess|fix|test`), `assess` (intake → research → define → shape → decide, go/needs-clarification/kill). CLI: `specify init --here --force --non-interactive --integration claude` for harnesses; `specify self upgrade`. Codex/skills-mode agents get `$speckit-*` skills instead of slash commands.

### BMAD-METHOD v6
- Phases: **Analysis** (optional: `bmad-brainstorming`, `bmad-forge-idea` → brainstorm.html, forge-report.html) → **Planning** (`bmad-prd` → prd.md + addendum.md; `bmad-spec` → SPEC.md "canonical contract"; UX) → **Solutioning** (`bmad-architecture` → ARCHITECTURE-SPINE.md; epics/stories; sprint readiness) → **Implementation** (`bmad-build` / `bmad-build-auto`, `bmad-code-review`, course-correct, retrospective).
- Entry points: `bmad-build <change>` (right-sizes: "Small changes go straight to build"), `bmad-help` (what's next / optional). Artifacts under `_bmad/` and `docs/`; project context in `AGENTS.md` via `bmad-project-context`. Agents: analyst, pm, architect, sm, dev, tea, ux; "party mode" multi-agent discussion.
- Story loop (v6 guidance): fresh chat `create-story` → fresh chat `dev-story` → optional `code-review` → repeat; `sprint-status.yaml` written by `bmad-sprint-planning`.
- **bmad-loop** (`uv tool install "bmad-loop[tui] @ git+…"`): `bmad-loop init --cli claude` → `validate` → `run`/`tui`. Loop per story: `DEV (claude runs /bmad-build-auto <story>) → VERIFY (spec exists, baseline commit matches, non-empty diff, run [verify].commands) → REVIEW (fresh window, adversarial review skills; trigger recommended|always) → VERIFY again → COMMIT (orchestrator squashes)`. Completion detected via hook payloads (`Stop`, `SessionStart/End`, `PreCompact`) written to `$XDG_STATE_HOME/bmad-loop/<project>/<run>/events/` — "No pane-scraping." Policy `.bmad-loop/policy.toml`: `[limits] max_review_cycles=3, max_dev_attempts=2, session_timeout_min=90, max_tokens_per_story=2_000_000`; `[scm] isolation=none|worktree, branch_per=story|run, merge_strategy=ff|merge|squash, rollback_on_failure`; `[gates] mode=none|per-epic|per-story-spec-approval`; `[review]`, `[sweep]`, `[adapter]` (claude|codex|gemini|copilot|antigravity|opencode-http, per-stage model overrides). Escalations: CRITICAL pauses run (`ATTENTION` file; `bmad-loop resolve <run>`), PREFERENCE journaled. Deferred-work ledger `deferred-work.md` (`DW-n`, gates, `closes_deferred:` in story frontmatter) with `bmad-loop sweep` triage. `status --json`/`validate --json` for scripting.
- Community: `stephenleo/bmad-autonomous-development` (BAD) — coordinator "never reads files or writes code itself"; dependency graph from sprint backlog + GitHub PR status; `MAX_PARALLEL_STORIES=3` in worktrees; 7-step story pipeline (spec → failing acceptance tests → implement → test-quality review → code review on premium model → commit/push/PR/CI watch → PR-diff review); `MODEL_STANDARD=sonnet`, `MODEL_QUALITY=opus`, optional `AUTO_PR_MERGE`.

### GSD (gsd-core)
```
.planning/
├── PROJECT.md            # vision, constraints, baseline decisions
├── REQUIREMENTS.md       # REQ-tracked specs with verification tier
├── ROADMAP.md            # phase sequence, status, dependencies (checkboxes are annotations only)
├── STATE.md              # session history, decisions, deferred scope, checkpoints (warn if >20 commits stale)
├── config.json           # workflow toggles, model profile
├── {phase}-CONTEXT.md    # discussion findings/assumptions
├── {phase}-PLAN.md       # tasks grouped into waves
├── {phase}-{N}-SUMMARY.md# per-plan execution result with per-deliverable coverage block
└── {phase}-VERIFICATION.md # UAT verdict; phase completion is disk-strict on this file
```
Loop per phase: `/gsd-discuss-phase N` (or `/gsd-spec-phase N` Socratic + edge/prohibition probes) → `/gsd-plan-phase N` (research + plan + verify plan fits a fresh window; `--converge` cross-AI review up to 3 cycles) → `/gsd-execute-phase N [--wave K] [--tdd]` (executors in parallel per wave, "each executor starts with a clean 200k-token context") → `/gsd-verify-work N` (coverage-aware UAT: test-proven deliverables auto-pass with `source: automated`, judgment items to human; `backstop` checks abstain) → `/gsd-ship N [--draft]` (PR + archive). Navigation: `/gsd-next` (state-aware router), `/gsd-progress --next --auto`, `/gsd-pause-work`/`resume-work`. Autonomy: `/gsd-autonomous [--from 3 --to 5] [--converge] [--no-reversibility-gates]` — "Checkpoints still pause for human decisions (one-way doors, missing data, unresolved reviews)." Brownfield: `/gsd-onboard`, `/gsd-map-codebase`, `/gsd-graphify`, `/gsd-ingest-docs`. Defaults: tracer-first decomposition (`--no-tracer` to opt out), `--mvp` Walking Skeleton on phase 1, `/gsd-quick` for one-offs, `/gsd-undo --last N`, `/gsd-health --repair`, `/gsd-extract-learnings`. Namespace routing (`/gsd-workflow`, `/gsd-quality`, …) cuts the command listing from ~2,150 to ~120 tokens.

## Workflow: end to end (compressed)

- **Spec-Kit**: `specify init` → constitution → specify (branch + spec.md) → clarify → plan (+research/data-model/contracts/quickstart) → tasks → analyze → implement → checklist/converge loop → PR by hand.
- **BMAD**: install → (analysis) → PRD/SPEC → architecture → epics & stories → sprint-planning (`sprint-status.yaml`) → per story: create-story / dev-story / code-review in fresh chats, or `bmad-loop run` unattended → retrospective.
- **GSD**: `/gsd-new-project` or `/gsd-onboard` → roadmap → per phase discuss → plan → execute (waves) → verify → ship → `/gsd-complete-milestone` (9-category audit) → next milestone.

## Notable techniques worth stealing

- **Constitution / project-context file that every later prompt must comply with** (Spec-Kit `/speckit.constitution`; BMAD `bmad-project-context` → AGENTS.md; GSD `PROJECT.md`). Ours: `CONTEXT.md` + ADRs (already in Sandcastle/afk-workflow).
- **Feature-numbered directories on their own branch** with spec/plan/tasks side by side (Spec-Kit) — trivially maps to one goblin per `specs/NNN-*/`.
- **`[P]` parallel markers in tasks.md / waves in PLAN.md** — planner emits the dependency structure; executor fans out per wave with fresh contexts.
- **Converge command**: re-audit code against spec+plan+tasks and loop until Converged (a sensor for a control loop).
- **Deterministic orchestrator, LLM only for creative steps** (bmad-loop): "Story selection, retry budgets, gates, and completion checks are code, not prompts"; hooks write JSON event files instead of pane-scraping; verification checks disk artifacts (spec frontmatter status, baseline commit, non-empty diff) — never the agent's claim.
- **Separate dev and review sessions** so "review never inherits the implementer's context, so there's no anchoring bias" (bmad-loop) — Dex's "dumb model writes, smart model checks."
- **Bounded budgets per story**: max dev attempts, max review cycles, session timeout, token cap; plateau-defer with a deferred-work ledger instead of infinite retry.
- **Escalation classes** (CRITICAL pauses, PREFERENCE journals) and an `ATTENTION` file the human resolves.
- **Disk-strict completion + honest verifier** (GSD): a phase is done only if `VERIFICATION.md` exists; checks that cannot be inferred abstain rather than pass.
- **Coverage block** joining requirement → test → status per deliverable, so UAT auto-passes only what tests prove.
- **State-aware router (`/gsd-next`)** and `STATE.md` staleness warnings — cheap session resume.
- **Reversibility gates**: pause only on one-way doors when running autonomously.
- **Namespace routing of commands** to cut skill-listing tokens.

## Weaknesses / open questions / risks

- **Ceremony vs solo dev**: BMAD's seven personas and multi-document planning are aimed at teams; GSD's 80+ commands and ADR-heavy internals are a maintenance surface of their own (its own changelog shows hundreds of bug-fix changesets). Spec-Kit is lighter but still one-session-per-feature with a human typing each command.
- **Autonomy is bolted on**: Spec-Kit has none; BMAD's is a separate tmux+Python orchestrator that requires a full BMAD v6 project (`_bmad/bmm/config.yaml`, review skills); GSD's `/gsd-autonomous` is a single long-lived agent session orchestrating subagents inside the runtime — it inherits that runtime's subagent limits and is opaque compared to an external loop.
- **Plan-reading illusion applies to all three**: long generated PRDs/plans feel reviewed but aren't (see `rpi-qrspi-humanlayer-skills.md`).
- **Runtime coupling**: BMAD installer copies role prompts per IDE; GSD requires its installer ("do not copy files from agents/ or commands/ directly"); neither ships a pi target today. Spec-Kit's `--integration` list is the broadest but pi is not on it either.
- Spec-Kit's "code is regenerated output" philosophy is stronger than the tooling (converge is an audit, not regeneration).
- Star counts (131k/64k/52k) reflect virality more than factory-grade reliability; no published eval data.

## Fit for our agentic stack

None should be installed wholesale; each donates a piece:

- **Artifact chain (from Spec-Kit)**: `specs/NNN-<slug>/{spec,plan,tasks}.md` + a repo `CONSTITUTION.md`/`CONTEXT.md`. Keep `tasks.md` as the human-readable projection but load the tasks into Beads with `blocks` edges (the `[P]`/wave structure becomes the dependency graph). `converge` becomes a sensor script/goblin that runs after a night shift.
- **Orchestrator design (from bmad-loop)**: plain code drives pick → dev → verify → review → verify → commit; agents signal completion through structured output (pi `--mode json` final event, or a file the agent writes), never scraped text; verification trusts disk (diff non-empty, tests pass, spec status updated); separate pi sessions for dev and review; per-task budgets (`max_dev_attempts`, `max_review_cycles`, token cap) and CRITICAL/PREFERENCE escalation with an `ATTENTION` file. This is what our `foundry` daemon should look like — replace tmux with one cloud VM per story.
- **Verification semantics (from GSD)**: disk-strict phase completion (`VERIFICATION.md` or a Beads gate), coverage block per deliverable, honest-verifier abstention, reversibility gates as the only human checkpoints in autonomous mode.
- **Planning (from GSD/BMAD)**: discuss-before-plan to capture decisions in `CONTEXT.md`; tracer-first / walking-skeleton decomposition (matches Pocock's vertical slices); `STATE.md`-style resume note per run.
- **Skip**: BMAD personas and party mode; GSD's installer/runtime abstraction layer; Spec-Kit's `specify` CLI (just copy the three templates); web bundles.
- **pi specifics**: all three are markdown prompts underneath, so their templates load into `.agents/skills/` or `.pi/prompts/` with light editing. The valuable parts to port are the *templates* (Spec-Kit `spec-template.md`, `plan-template.md`, `tasks-template.md`; GSD `PLAN.md` wave format; BMAD story frontmatter with `closes_deferred`) — not the command routers.

## Related resources mentioned

- https://github.com/bmad-code-org/bmad-loop — deterministic ralph-loop orchestrator (policy.toml, hooks-as-events, worktree isolation, deferred-work ledger).
- https://github.com/stephenleo/bmad-autonomous-development — BAD: parallel worktree story pipeline with PR/CI sync.
- https://github.com/stefanoginella/auto-bmad — one-story-at-a-time BMAD module with model/effort-tuned subagents (Claude Code or Codex).
- https://www.bmadcode.com/bmad-method-has-three-flows-now-heres-what-actually-changes-between-them/ — quick-flow vs method vs enterprise paths.
- https://github.com/open-gsd/gsd-core/blob/next/docs/ARCHITECTURE.md and `docs/explanation/context-engineering.md`, `the-phase-loop.md` — GSD's rationale docs.
- https://github.com/open-gsd/gsd-core/tree/next/docs/adr — 90+ ADRs (e.g. `22-plan-drift-guard`, `1606-prohibition-enforcement-verify-seam`, `2966-loop-qa-walk`, `3473-enforcement-by-construction`) — a mine of verified-in-practice orchestration rules.
- https://github.com/rokicool/gsd-opencode — original OpenCode port of GSD.
- https://github.github.io/spec-kit/ — extensions/presets/bundles catalog; `spec-driven.md` full methodology essay.
- https://www.manorrock.com/blog/2026/08/21/spec_kit_turns_one.html — 1.0.0 rationale.

## Key quotes / references

- "Specifications don't serve code—code serves specifications." — Spec-Kit `spec-driven.md`
- "Repeat steps 4 and 5 until `/speckit-converge` reports **Converged**." — Spec-Kit README
- "Coding assistants are effective at implementation, but they often turn unstated assumptions into code." — BMAD README
- "Plain Python drives the loop — pick story → implement → adversarially review → verify → commit — while LLMs do only the creative work." — bmad-loop
- "Trust nothing, verify everything. After each session the orchestrator checks artifacts on disk." — bmad-loop
- "Execute — run plans in parallel waves; each executor starts with a clean 200k-token context." — gsd-core README
- "Disk-strict phase completion: Checked unconditionally against `*-VERIFICATION.md` on disk; roadmap checkboxes are annotations only." — gsd-core COMMANDS.md

## Gaps

- Did not read Spec-Kit's actual templates (`templates/spec-template.md`, `plan-template.md`, `tasks-template.md`) or the `converge` command prompt.
- Did not read BMAD story file format, `sprint-status.yaml` schema, or the `bmad-build-auto` skill; BMAD docs site fetch was shallow.
- GSD's `PLAN.md` wave syntax, `coverage:` block schema, and `gsd-tools.cjs` were not inspected; the ADR directory is a promising follow-up.
- No hands-on run of any of the three.
