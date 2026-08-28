# humanlayer/skills

- **URL:** https://github.com/humanlayer/skills
- **Type:** skills/agents
- **Author/Org:** HumanLayer (Dex Horthy et al.)
- **Researched:** 2026-08-26
- **Status/maturity:** 561 stars, 20 forks, MIT, 12 commits, pushed 2026-08-13, 2 open issues/PRs. Small, opinionated, current. Partially covered in research/blogs/dexhorthy-context.md; this is the full catalog.

## One-paragraph summary

Five skills, each packaged as its own Claude Code plugin under `plugins/<name>/` and indexed by a root `.claude-plugin/marketplace.json` (marketplace name `skills`, owner humanlayer). Install via `npx skills add humanlayer/skills --skill <name>`. Two are one-shot utilities (`improve-claude-md`, `show-me`), one is a TypeScript-specific refactor discipline (`narrow-react-prop-types`), and two are **factory-relevant generators**: `build-iterated-agentic-loop` and `design-control-loop` scaffold a repo-local skill plus a scheduled GitHub Actions workflow that runs a coding agent (Claude Code, Codex, OpenCode, or CodeLayer), bounded to one open PR per loop, with an `/iterate` comment path and a memory file. The mental model is explicitly control theory: set point, sensor, controller, actuator, disturbances.

## Core ideas / thesis

- **Agents as control loops, not chat.** Drive a codebase property toward a set point with small reviewable PRs on a cadence; a human stays *on* the loop, not *in* it.
- **Bound work-in-progress.** Scheduled runs no-op while an agent-labelled PR is open; only `workflow_dispatch` bypasses.
- **Memory between runs** is a plain Markdown file (`.github/agent-memory/<task>.md`) the workflow feeds into the prompt and that `/iterate` may update.
- **CLAUDE.md adherence via `<important if="...">`**: exploit Claude Code's own XML-tag system-prompt idiom to beat the "may or may not be relevant" reminder.

## Architecture & mechanics

### Repo layout
```
.claude-plugin/marketplace.json                # 5 plugin entries, category productivity, source ./plugins/<name>
plugins/<name>/.claude-plugin/plugin.json      # name, description, version, author, repository, license MIT, keywords
plugins/<name>/skills/<name>/SKILL.md          # spec-only frontmatter: name + description
plugins/<name>/skills/<name>/references/*      # templates
```

### Catalog

| Skill | Inv | What it does | Bundled references | pi/CC |
|---|---|---|---|---|
| `improve-claude-md` v1.0.0 | user (`/improve-claude-md`) | Rewrites CLAUDE.md: foundational context bare; domain guidance wrapped in `<important if="condition">` with specific, targeted conditions (bad: "you are writing code"); principles for condition wording | none | Both (pi reads CLAUDE.md/AGENTS.md but does not inject the "may or may not be relevant" reminder, so the trick is less needed there) |
| `narrow-react-prop-types` v1.0.0 | user | 6-step workflow: find live (non-story/test) call sites → classify props required/optional/removed → prefer required-nullable over optional → derive types (`Parameters<>`, `ReturnType<>`, `Extract<>`) → tighten child primitives | `agent-narrow-component-props.yml` (recurring GHA via CodeLayer), `narrow-component-props-memory.md`, `response-template.md` | Both (TS only) |
| `build-iterated-agentic-loop` v1.0.0 | user | Generator: explores repo (workflows, package manager, validation scripts, existing `.claude/skills` + `.agents/skills`), asks 9 setup questions (agent, cadence, task, scope, validation, **PR bounding**, PR metadata `[MM/DD][Agent: Name]: desc`, response format, `/iterate` behavior), then writes `.claude/skills/<skill>/SKILL.md`, `.github/workflows/agent-<task>.yml`, `.github/agent-memory/<task>.md`, optional `references/` | `workflow-template.yml`, `prompt-template.md`, `memory-template.md`, `skill-template.md`, `example-skill.md`, `response-template.md`, `agent-runner-templates.md`, `agent-iteration.ts` (modes `footer` / `prompt`) | Both as instructions; generated workflow targets Claude/Codex/OpenCode/CodeLayer, not pi (add a runner template) |
| `design-control-loop` v1.0.0 | user | Interview-then-build: Phase A read repo; Phase B design set point / sensor / controller / actuator / dampener with the user; Phase C write design; Phase D build each component locally-runnable standalone before CI; outputs sensor+controller scripts, actuator skill (`.claude/skills/` or `.agents/skills/` per repo convention), workflow, memory file, optional regression gate | same as above + `control-loop-taxonomy.md`, `example-control-loop.md` | Both |
| `show-me` v1.0.1 | user | Explain the current topic visually: pseudocode, call tree, component tree, shallow file tree, Mermaid sequence/flow, `diff` of shape; single-file HTML artifact when needed | none | Both |

### The workflow template (what the generator emits)
Triggers: `schedule` cron, `workflow_dispatch`, `issue_comment` (types created) gated to `/iterate` by OWNER/MEMBER/COLLABORATOR on a PR whose body carries the agent's marker. `permissions: contents/pull-requests/issues: write`; `concurrency: agent-<slug>` cancel-in-progress. Step 1 `agent_gate`: on `schedule`, `gh pr list --label agent-<slug> --state open` → if ≥ bound, `run_agent=false`. Then checkout, setup, run the agent headless with the prompt template + memory file, validation commands, commit to `agent/<slug>/<date>` branch, open labelled PR with the response template as body.

### Control-loop taxonomy (reference)
Set point (invariant / threshold / direction) → Sensor (lint, AST search, tests, type checker, coverage, custom script) → Controller (deterministic ranking to LLM judgement; sizes "one reviewable unit") → Actuator (coding agent + repo-local skill in CI opening a PR) ← Disturbances (teammates, deps, codegen, flaky tests). Fusions allowed (sensor+controller, controller+actuator). Optional **dampener** = regression gate stopping the metric getting worse. Mermaid flowchart included.

## Workflow: end to end

`/design-control-loop` → agreed design doc → `sensor` script (e.g. `bunx react-doctor --json`) → `controller` script picks N targets → actuator skill in `.agents/skills/<name>/` → `agent-<task>.yml` on cron → PR labelled `agent-<task>` → human reviews; comments `/iterate <feedback>` → workflow reruns in prompt mode against that PR and may append to `agent-memory/<task>.md` → next scheduled run no-ops until the PR is merged/closed.

## Notable techniques worth stealing

- **PR-bounded scheduled loops** (`gh pr list --label … | jq length`) are the simplest back-pressure mechanism for an unattended factory; adopt as a hard rule per agent lane.
- **`/iterate` comment protocol with a PR-body marker** so all agent workflows can listen cheaply and only the owning one proceeds.
- **Agent memory as a reviewed Markdown file in-repo** (standing feedback + scope constraints), updated only via `/iterate`; matches Pocock's `CONTEXT.md` philosophy and pi's AGENTS.md convention.
- **Sensor/controller as standalone local scripts, wired into CI last** (Phase D). Makes the loop testable without the agent.
- **Set-point framing** for factory KPIs (coverage ≥ X, zero deprecated-API usages, dependency freshness) with a dampener gate.
- **`<important if>` wrapping** for conditional guidance in CLAUDE.md; cheap to try.
- **Response template as PR body** (summary stats, risk level, verification steps) standardizes what reviewers see.
- Repo shape: one plugin per skill, spec-only frontmatter, `references/` for templates. Very portable.

## Weaknesses / open questions / risks

- GitHub Actions-centric; the generated runners are Claude Code / Codex / OpenCode / CodeLayer (`agent-runner-templates.md`), no pi runner.
- Loops scaffold but don't include evaluation of loop health (drift, thrash); no dampener by default.
- Tiny community (561 stars, 12 commits); CodeLayer references assume HumanLayer's product.
- `improve-claude-md` is a Claude-specific prompt hack; unverified effect on other harnesses.

## Fit for our agentic stack

High for the two loop skills, which are essentially the "outer loop" blueprint (Ralph-style scheduled iteration) for goblin-foundry, and they already prefer `.agents/skills/` when the repo uses it.
- Adopt `design-control-loop` conceptually as the way we define each factory lane: set point, sensor, controller, actuator (pi worker in a sandbox), dampener.
- Fork `workflow-template.yml` into a pi runner: `pi -p --no-session --skill ./.agents/skills/<name> "$(cat prompt.md)"` (or `pi --mode json` for structured logs), keep the PR-bound gate and `/iterate` marker verbatim.
- Store per-lane memory at `.github/agent-memory/<lane>.md` and have the pi extension inject it via `before_agent_start`.
- Use `show-me` in review/handoff skills for diagram output.

## Related resources mentioned

- CodeLayer / humanlayer.com — "ultra-lightweight agent harness" used as a runner option.
- `bunx react-doctor` — example sensor.
- research/blogs/dexhorthy-context.md — 12FA, ACE/RPI, Ralph loop background.
- Claude Code `/loop` and scheduled tasks/routines — in-harness alternative to GHA cron.

## Key quotes / references

- "The rule of thumb: if it's relevant to 90%+ of tasks, leave it bare. If it's relevant to a specific kind of work, wrap it." (`improve-claude-md`)
- "Recommended: Yes, bound to 1 open PR per agent loop. This prevents the agent from creating unbounded work that piles up faster than humans can review." (`build-iterated-agentic-loop`)
- "Make each component runnable locally and standalone before wiring it into CI." (`design-control-loop`)
- "Design the loop the user actually needs; don't manufacture separation that isn't there." (`control-loop-taxonomy.md`)

## Gaps / fetch notes

- `agent-runner-templates.md`, `example-control-loop.md`, `agent-iteration.ts`, `prompt-template.md` not read in full; workflow template read to the gate step.
