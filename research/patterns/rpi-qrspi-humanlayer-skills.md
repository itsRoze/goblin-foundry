# RPI → QRSPI and humanlayer/skills (design-control-loop, build-iterated-agentic-loop)

- **URL:** https://alexlavaee.me/blog/from-rpi-to-qrspi/ (Alex Lavaee summary) · https://www.youtube.com/watch?v=YwZR6tc7qYg ("Everything We Got Wrong About Research-Plan-Implement", Dex Horthy, Coding Agents Conference, Mar 2026) · https://github.com/humanlayer/skills · original RPI prompts: https://github.com/humanlayer/humanlayer/tree/main/.claude/commands (`research_codebase.md`, `create_plan.md`, `implement_plan.md`)
- **Type:** blog + skills/agents
- **Author/Org:** Dex Horthy / HumanLayer (CodeLayer product); Alex Lavaee (summary post)
- **Researched:** 2026-08-26
- **Status/maturity:** humanlayer/skills: 561 stars, 20 forks, MIT, last push 2026-08-13; 5 plugins in a single-marketplace repo (`.claude-plugin/marketplace.json` → `plugins/<name>/skills/<name>/SKILL.md` + `references/`). Install: `npx skills add humanlayer/skills --skill <name>`. RPI itself is deprecated in favour of QRSPI; the humanlayer/humanlayer repo holding the original commands is archived. Community reimplementation: dfrysinger/qrspi-plus (38 stars, MIT).

## One-paragraph summary

RPI (Research → Plan → Implement, from the ACE-FCA talk, Aug 2025) was three slash commands that forced an agent to (1) map the codebase into a facts-only research doc, (2) negotiate a phased plan with explicit automated/manual success criteria, and (3) implement phase-by-phase, checking boxes in the plan file. At scale it failed in three ways — instruction-budget overflow (85+ instructions in one prompt; models silently drop steps past ~150–200), magic-word dependency ("Work back and forth with me…" had to be typed exactly), and the plan-reading illusion ("A 1,000-line plan contains as many surprises as 1,000 lines of code"). QRSPI spreads the alignment across more, smaller phases — Questions, Research (ticket hidden), Design discussion (~200-line brain dump the engineer edits), Structure outline (header-file-like signatures and vertical slices), Plan (spot-check only), then a work tree, Implement, PR — with the rule of fresh contexts under 40% and subagents as "context firewalls." In parallel, humanlayer/skills ships two meta-skills for *recurring* agent work: `design-control-loop` (interview → sensor/controller/actuator/dampener → local scripts → scheduled CI workflow → memory file + `/iterate`) and `build-iterated-agentic-loop` (the same output shape without the control-theory interview), plus `improve-claude-md` (`<important if="…">` blocks).

## Core ideas / thesis

- **Alignment before code; implementation is the cheap part.** Lavaee: "Implement ... is a small fraction of the overall cycle despite speed gains. Quality stems from alignment phases."
- **Instruction budget is real.** Frontier models degrade past ~150–200 instructions per prompt; a workflow must be split into phases each with a small instruction set rather than one mega-prompt. (Same reasoning as `improve-claude-md`: "Frontier models can reliably follow a few hundred. Claude Code's system prompt and tools already use ~50 of those.")
- **Facts, not narrative.** Research must produce a "technical map" without opinions; the original `research_codebase.md` already said "Document what exists—not what should be improved ... Never suggest improvements unless explicitly requested." QRSPI adds: hide the feature ticket during research so the agent cannot form a premature implementation opinion.
- **Plans are code.** If reviewing the plan is the quality gate, the plan must be short enough to actually validate — hence Design (~200 lines) and Structure (signatures) are reviewed deeply; the Plan is only spot-checked.
- **Context thresholds**: keep under 40%, start fresh at 60%; "larger windows don't help when filled with noise."
- **Subagents are context firewalls, not personas**: expensive model orchestrates, cheap models do scoped search/test/format, coordination through filesystem artifacts (`thoughts/` in RPI; `docs/qrspi/<date>-<slug>/` in qrspi-plus).
- **Control loops for recurring work**: a codebase is a dynamic system under disturbance; drive a property to a set point with small reviewable PRs on a schedule, with a human *on* the loop (memory file + `/iterate`) rather than *in* it.

## Architecture & mechanics

### RPI (original commands, humanlayer/humanlayer `.claude/commands/`)
- `research_codebase.md`: read mentioned files fully → decompose question → spawn parallel `codebase-locator`, `codebase-analyzer`, `pattern-finder`, `thoughts-locator` subagents → wait for all → `hack/spec_metadata.sh` → write `thoughts/shared/research/<date>-<topic>.md` with YAML frontmatter (date, researcher, commit, branch, tags), summary, detailed findings with `file:line` refs, architecture, historical context, open questions. Rules: no critique, no root-cause analysis unless asked.
- `create_plan.md`: 5 steps — context gathering (read files, spawn research tasks, ask focused questions) → research & discovery → propose *phasing* and get feedback before writing → write plan from template → sync & iterate. Plan template per phase has **Automated Verification** (`make test`, compile) vs **Manual Verification** (UI, perf, UAT) — "clarity about what execution agents can verify independently versus what requires human confirmation." Principles: thoroughness, skepticism, interactivity, practicality; explicit out-of-scope section.
- `implement_plan.md`: read plan + ticket + all referenced files fully; implement phase by phase; run success criteria; check off `- [x]` in the plan file; on mismatch "STOP and think deeply ... Present the issue clearly ... Ask how to proceed"; **pause for human verification after each phase** unless told to run phases consecutively; resume from first unchecked item, trusting checked ones.

### QRSPI (8 phases)
| Phase | Artifact | Who reviews / how deep |
|---|---|---|
| **Q**uestions | list of knowledge-gap questions that force full-codebase traversal | engineer writes/edits |
| **R**esearch | facts-only technical map; ticket hidden | engineer skims for correctness |
| **D**esign discussion | ~200-line brain dump: current state, desired end state, decisions | engineer "brain surgery" — deep review, redirect to house architecture |
| **S**tructure outline | signatures, new types, phases; vertical slices (mock API → FE → DB) with checkpoints; "analogous to C header files" | deep review |
| **P**lan | tactical steps constrained by D+S | spot-check only |
| Work tree | tasks mapped to testable vertical-slice units | — |
| **I**mplement | code, fresh contexts <40% | automated checks |
| **PR** | human review with ownership; "no slop makes it into production" | full |

qrspi-plus (dfrysinger) extends to 12 steps (Goals, Questions, Research, Design, Phasing, Structure, Plan, Parallelize, Implement, Integrate, Test, Replan) under `docs/qrspi/YYYY-MM-DD-{slug}/` with `config.md`, `tasks/task-NN.md`, `parallelization.md`, `reviews/`, `fixes/`, `feedback/`, `phases/phase-NN/`; per-task worktrees, 8 tiered reviewers, acceptance tests traced to goals, between-phase replanning with severity classes, and "artifact gating — each step verifies approved inputs before proceeding." A "quick fix" route skips Design/Phasing/Structure/Parallelize/Integrate.

### humanlayer/skills — `design-control-loop`
Phases A–H in `SKILL.md` (each names which `references/*.md` to read):
- **A Understand**: read CI, package manager, validation scripts, existing `.claude/skills` and `agent-memory` conventions, static-analysis tooling ("most likely raw material for a sensor").
- **B Design (interview)**: set point (invariant / threshold / direction + scope), sensor (lint, AST search, tests, typecheck, telemetry, custom script, agent check — discuss stability/cost/silently-disable-able), controller (deterministic script … fully agentic; "the part you will tune over time"), actuator (CLI agent + repo-local skill + validation commands + "golden patterns first"), disturbances + optional **dampener** (PR check comparing sensor output to baseline, advisory → blocking).
- **C Build actuator skill** at `.claude/skills/<slug>/SKILL.md` (name must equal directory slug), ordered steps with checkable completion criteria, response template that becomes the PR body.
- **D Run locally first**: sensor, controller, actuator each standalone before CI.
- **E Wire CI**: `references/workflow-template.yml` — cron + `workflow_dispatch` + `issue_comment`; discrete steps sensor → controller → actuator → commit → PR (collapse when fused); embedded `references/prompt-template.md` (Context / Scope / Instructions / Validation Commands / Important Rules incl. "You are running in a sandbox or CI runner environment. Do not stop and ask for feedback" / Output Format).
- **F Human on the loop**: `.github/agent-memory/<slug>.md` loaded into the actuator *after the controller* every run ("Keep durable guidance only — not one-off instructions or single-run logs"); `/iterate <feedback>` comments routed by a hidden PR-body marker `<!-- codelayer-agent:workflow=<id>;memory=<path>;version=1 -->` — `references/agent-iteration.ts` has `footer` and `prompt` modes; the iteration prompt tells the agent to update the PR and "distill durable feedback into <memory> when it should influence future runs."
- **G Flow control**: "one open PR per loop" — scheduled runs `gh pr list --label agent-<slug> --state open` and no-op if any; manual dispatch bypasses.
- **H Validate / dry-run / iterate faster**: temporarily add a `push` trigger to get the first run; then increase cadence, batch size, or cycles per run.
`references/control-loop-taxonomy.md` adds: scope gate, batch size, "components can blur" (sensor+controller fused, controller+actuator fused). `references/example-control-loop.md` = React Doctor loop (sensor `bunx react-doctor`, policy "fix up to 5 issues from the top 3 rules", per-issue fix/ignore/skip, dampener workflow commenting only on newly introduced issues).

### `build-iterated-agentic-loop`
Same outputs (`.claude/skills/<name>/SKILL.md`, `.github/workflows/agent-<task>.yml`, `.github/agent-memory/<task>.md`) driven by 9 setup questions: agent (Claude Code / Codex / OpenCode / CodeLayer + secret + headless command from `agent-runner-templates.md`), cadence, task, scope, validation, PR bounding (recommend 1), PR metadata (`[MM/DD][Agent: <Name>]: <desc>`), response format, `/iterate`. Defines the job as *what are we finding* (CLI report, search pattern, diff, old→new pattern, flaky test) / *what are we changing* (fix, migrate, generate, refactor) / *how do we validate*.

### `improve-claude-md`
Wrap task-specific guidance in `<important if="you are adding or modifying imports">…</important>` blocks; leave 90%-relevant context bare; keep it short; avoid sharding into files that need tool calls.

## Workflow: end to end

**Feature (QRSPI)**: ticket → engineer writes Questions → fresh-context Research (ticket hidden) → Design doc, edited by engineer → Structure outline (types/signatures, vertical slices) → Plan → work tree → implement each slice in a fresh context (<40%), compacting progress into the plan → PR reviewed by a human who owns it.

**Recurring maintenance (control loop)**: `/design-control-loop` interview → sensor + controller scripts in repo → actuator skill → run all three locally → `agent-<slug>.yml` cron → one PR per run, labeled → reviewer comments `/iterate …` → agent updates PR + memory file → next scheduled run reads memory.

## Notable techniques worth stealing

- **Ticket-hidden research**: give the researcher only questions, not the feature, to get a facts-only map.
- **Design doc (~200 lines) as the deep-review artifact; plan only spot-checked** — put human attention where it validates feasibility.
- **Structure outline = header file**: types and signatures before any implementation; forces vertical slices with checkpoints.
- **Automated vs manual verification split per phase** (from `create_plan.md`) — tells the implementer exactly where to pause for a human.
- **Checkbox-in-plan progress + resume from first unchecked** (from `implement_plan.md`) — trivially restartable across fresh contexts.
- **Instruction budget as a design constraint**: count instructions per prompt; split phases when >~100.
- **Control-loop vocabulary** (set point / sensor / controller / actuator / disturbance / dampener / flow control / memory) — a reusable design checklist for any scheduled agent job.
- **Memory file loaded after the controller, edited only via `/iterate`** — human steering that changes future behaviour, not just this PR.
- **PR-bounded flow control** (no new run while a labeled PR is open) and hidden-marker routing so many loops can share one `/iterate` trigger.
- **"Run each component locally before CI"** and "the workflow should only orchestrate pieces the user can already run by hand."
- **Prompt template's CI rule**: "You are running in a sandbox or CI runner environment. Do not stop and ask for feedback from the user or request approvals."

## Weaknesses / open questions / risks

- QRSPI is documented mostly in a talk and third-party summaries; there is no canonical open-source prompt set (CodeLayer is the product). qrspi-plus is one person's interpretation.
- QRSPI is human-heavy by design (engineer writes questions, edits design) — it is a *day-shift* process, not an autonomous loop; expect 5 review touchpoints per feature.
- humanlayer/skills is GitHub-Actions-first (`gh`, `GITHUB_TOKEN`, cron); the loop's isolation is the CI runner. Templates assume bun/Node.
- The `/iterate` marker string is branded `codelayer-agent`.
- `improve-claude-md` exploits a Claude-Code-specific system-reminder quirk; irrelevant to pi (which shows the prompt and has no "may or may not be relevant" preamble).

## Fit for our agentic stack

- **Day shift = QRSPI-lite.** For a solo dev, collapse to Q → R (ticket hidden) → D+S in one ~200-line doc → P, each as a separate pi session (`pi --no-session -p` with `--append-system-prompt` per phase) writing to `thoughts/` or `docs/qrspi/<slug>/`. Enforce the instruction budget by keeping each phase prompt under ~40 instructions. Reuse `create_plan.md`'s automated/manual verification split so the night shift knows where it may not proceed alone.
- **Night shift = control loops + Ralph/Beads.** The design-control-loop shape ports cleanly off GitHub Actions: sensor and controller are scripts run by the orchestrator on the host; the actuator is `pi --mode json -p` in a cloud VM with the actuator SKILL.md in `.agents/skills/`; flow control = "no new VM for loop X while its labeled PR is open"; memory file lives in the repo and is appended to the prompt after the controller output. `/iterate` becomes a PR-comment webhook or a manual `foundry iterate <pr>` command that rebuilds the same prompt from `agent-iteration.ts`'s template.
- **Adopt**: sensor/controller/actuator/dampener as the required design doc for any recurring goblin; one-open-PR bound per loop; memory-file discipline; ticket-hidden research; header-file structure phase; checkbox plan resumption.
- **Adapt**: replace `gh pr list --label` gate with our merge-queue state; replace `<important if>` with pi's plain prompt sections.
- **Skip**: CodeLayer runner, `improve-claude-md`, qrspi-plus's 8-reviewer tiers (cost) until we have data that review depth is the bottleneck.

## Related resources mentioned

- https://github.com/dfrysinger/qrspi-plus — 12-step QRSPI plugin with worktree parallelization, tiered reviews, acceptance tests, replanning (bats-tested).
- https://github.com/bastani-inc/atomic — open-source tool cited by Lavaee as implementing the pipeline.
- https://github.com/millionco/react-doctor — the sensor in the worked control-loop example.
- https://agentskills.io/specification — skill spec the SKILL.md format follows.
- https://linearb.io/dev-interrupted/podcast/dex-horthy-humanlayer-rpi-methodology-ralph-loop — "escaping the Dumb Zone"; parent agent "shells out the phases as sub-agents."
- https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents — harness-engineering post referenced by both.
- https://betterquestions.ai/the-necessary-evolution-of-research-plan-implement-as-an-agentic-practice-in-2026/ — third-party commentary (not read).

## Key quotes / references

- "A 1,000-line plan contains as many surprises as 1,000 lines of code." — Horthy
- "if a tool requires magic words for basic functionality, the tool itself is broken." — Horthy
- "Document what exists—not what should be improved." — `research_codebase.md`
- "Pause for human verification: After completing all automated verification for a phase, pause and inform the human that the phase is ready for manual testing." — `implement_plan.md`
- "A scheduled loop drifts without steering. Give the human two channels, both of which should change future behavior, not just the current PR." — `design-control-loop/SKILL.md`
- "Bound work-in-progress so the loop never produces PRs faster than they can be reviewed. Recommended default: one open PR per loop." — same

## Gaps

- The QRSPI talk video itself was not watched; phase details come from Lavaee's post and search summaries. HumanLayer blog has no "everything-we-got-wrong" post (404).
- `agent-runner-templates.md`, `skill-template.md`, `response-template.md`, `example-skill.md`, and the `narrow-react-prop-types` reference loop were not read.
- Original `create_plan.md` template text was summarized by the fetcher rather than captured verbatim.
