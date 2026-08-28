# Beads (`bd`) — dependency-aware issue graph for coding agents

- **URL:** https://github.com/gastownhall/beads (steveyegge/beads redirects here) · docs https://beads.gascity.com/ · npm `@beads/bd` · PyPI `beads-mcp`
- **Type:** skills/agents (task tracker + agent memory CLI; the "work queue" layer of a factory)
- **Author/Org:** Steve Yegge → Gas Town Hall org (Yegge's Gas Town multi-agent orchestrator is the main downstream consumer)
- **Researched:** 2026-08-26
- **Status/maturity:** 26,624 stars, 1.8k forks, MIT, last push 2026-08-25 (very active, near-daily). Go, single binary, Dolt embedded. 80+ subcommands (`docs/cli-reference/`). Opt-out telemetry (`bd metrics off`, honors `DO_NOT_TRACK`). Adopted as an "issue tracker" option by Sandcastle, GSD, and others.

## One-paragraph summary

Beads replaces the Ralph-style `IMPLEMENTATION_PLAN.md` with a real graph database of issues that agents query and mutate through a CLI with `--json` everywhere. Issues have hash IDs (`bd-a3f8`, hierarchical `bd-a3f8.1.2` for epic/task/subtask) so parallel agents on different branches never collide; dependencies (`blocks`, `parent-child`, `relates-to`, `duplicates`, `supersedes`, `replies-to`) drive `bd ready`, which returns only open issues with no open blockers (excluding in_progress/blocked/deferred/hooked), and `bd ready --claim --json` atomically assigns the first one to the caller. Storage is Dolt — a version-controlled SQL DB with cell-level 3-way merge — in embedded (single-writer) or server (multi-writer) mode, synced across machines via `bd dolt push/pull` to `refs/dolt/data` on the git remote; `.beads/issues.jsonl` is an export, not the source of truth. On top sit agent-memory features (`bd prime` context injection for SessionStart hooks, `bd remember`, semantic compaction of closed issues) and a workflow-template layer (formulas → protos → molecules, gates, wisps) that encodes multi-step agent workflows as DAGs of beads.

## Core ideas / thesis

- **Markdown plans don't scale to long-horizon, multi-agent work.** README: "It replaces messy markdown plans with a dependency-aware graph." AGENTS.md snippet: "Do not use markdown TODO lists for task tracking."
- **Ready-work detection is the scheduler.** The graph, not an LLM, decides what is claimable. Agents run `bd ready`, pick, `--claim`, work, `bd close`; closing releases blockers → new ready work.
- **Conflict-free by ID design.** Hash IDs + Dolt cell-level merge: "Merge conflicts: Rare with hash IDs."
- **Memory decay.** Closed issues are compacted into summaries so the tracker itself does not blow the context window; `bd prime` keeps output at ~50 tokens (MCP mode) or 1–2k (CLI mode).
- **Git-optional.** `BEADS_DIR` + `--stealth` runs with zero git calls (CI, monorepos, `/tmp` eval databases).
- **Workflows are data.** Formulas (TOML/JSON) cook into protos (template epics), which pour into molecules (persistent) or wisp into ephemeral runs; gates (`human`, `timer`, `gh:run`, `gh:pr`, `bead`) block steps until external conditions hold.

## Architecture & mechanics

### Data model
- **Issue**: id (hash, optional hierarchical suffix), title, description, design, notes, acceptance, type (`task | bug | feature | epic | decision | merge-request | message | molecule`), priority `P0–P4`, status (`open ○ | in_progress ◐ | blocked ● | closed ✓ | deferred ❄`), assignee, labels, `defer_until`, ephemeral flag (wisps excluded from Dolt sync), `metadata` map, comments, audit trail (every write is a Dolt commit).
- **Execution metadata keys** the orchestrator reads before prose: `execution_agent_type`, `execution_suggested_model`, `execution_reasoning_effort`, `execution_mode`, `execution_parallel_group` — "treat them as the authoritative execution hints ... a running subagent cannot change its model or reasoning effort after launch."
- **Dependencies**: `blocks`/`blocked-by`, parent-child (via hierarchical IDs / `bd dep add <child> <parent>`), `relates-to`, `duplicates`, `supersedes`, `replies-to` (message threads).
- **Gates**: special issues that block another until resolved; `bd gate check` polls `gh run view` / `gh pr view` / timers / cross-rig beads and auto-closes or `--escalate`s.

### Storage / sync
- `.beads/embeddeddolt/` (embedded, single writer; default) or `.beads/dolt/` with external `dolt sql-server` (multi-writer). Dolt pinned at 2.2.0 (2.3.x regressed `DOLT_RESET('--hard')` on ~3–5% of fresh DBs).
- Sync: `bd dolt push` / `bd dolt pull` → `refs/dolt/data` on the git remote, so protected branches are untouched. Git hooks (`bd hooks install`): pre-commit commits pending Dolt changes; post-merge legacy JSONL import fallback.
- Schema version guard: stale binary refuses to open a newer DB (override `BD_IGNORE_SCHEMA_SKEW=1`).
- Compaction: `bd compact --days N` squashes old Dolt commits; `bd admin compact` = semantic summarization of closed issues; `bd flatten` full squash.

### Essential CLI
```
bd init [--stealth] [--contributor] [--server] [--prefix X]   # creates .beads/, AGENTS.md section, Claude/Codex hooks
bd prime [--hook-json] [--memories-only]     # workflow context for SessionStart hooks; override with .beads/PRIME.md
bd create "Title" -p 1 -t bug [--stdin | --body-file f.md] [--parent bd-x]
bd ready [--json] [--claim] [--explain] [--parent bd-x] [--label l] [--exclude-type epic] [--sort priority|hybrid|oldest]
bd show <id> [--json]          # includes audit trail; jq '.[0].metadata' for execution hints
bd update <id> --claim | --description=- | --design | --notes | --acceptance | --title   # never `bd edit` (opens $EDITOR)
bd dep add <child> <parent> ; bd dep tree <id> ; bd blocked
bd close <id> --reason "..." ; bd defer <id> ; bd comment <id> "..."
bd remember "insight" ; bd memories ; bd forget
bd gate create --type=gh:pr --blocks bd-abc --await-id 42 ; bd gate check --escalate ; bd gate resolve <id>
bd formula list|show ; bd cook <formula> --var name=auth ; bd mol pour|wisp|bond|squash|burn|distill
bd dolt push|pull ; bd export --all ; bd doctor --fix ; bd lint ; bd graph
bd setup claude|codex|factory|cursor|mux ; bd onboard ; bd github|gitlab|linear|jira|notion (import/sync bridges)
```
Conventions from `AGENT_INSTRUCTIONS.md`: commit messages end with the issue id in parentheses (`"Fix auth validation bug (bd-abc)"`) so `bd doctor` can flag orphaned issues (committed but not closed); pipe descriptions via `--stdin`/`--body-file` to dodge shell escaping; session-end protocol ("Landing the Plane"): quality gates → `bd dolt push` → `git push` → hand-off note.

### How agents pick ready work (the loop)
```
bd prime                       # (SessionStart hook) inject workflow + memories
bd ready --json                # open, unblocked, unclaimed, sorted by priority
bd update <id> --claim         # atomic assignee + in_progress; fails if someone else claimed
bd show <id> --json            # read metadata → choose model/effort/subagent
... implement ...
git commit -m "... (<id>)"
bd close <id> --reason "..."   # releases dependents → they appear in next `bd ready`
bd dolt push
```
`bd ready --claim --json` collapses steps 2–3 into one atomic call. `--explain` prints why each issue is/isn't ready (useful in prompts). `bd ready --gated` finds molecules whose gate just closed, for resume dispatch.

### Molecules (workflow templates)
Formula (`.beads/formulas/*.formula.toml`) → `bd cook` → proto (template epic, `template` label) → `bd mol pour` (persistent) / `bd mol wisp` (ephemeral) → child issues with `depends_on` edges. `bd mol bond A B --type sequential|parallel|conditional` composes workflows; `--ref arm-{{name}}` gives readable child IDs (`bd-patrol.arm-ace.capture`); `bd mol squash` condenses a finished molecule to a digest; `bd mol distill` extracts a reusable proto from an ad-hoc epic. Gates in formula steps become gate beads. This is Gas Town's substrate for "patrols" and per-worker "arms".

## Workflow: end to end

1. `bd init` in the repo (or `bd init --stealth` + `BEADS_DIR` in a throwaway VM); `bd setup claude` installs SessionStart → `bd prime --hook-json`.
2. Planner (human or agent) decomposes a spec into an epic with child tasks and `blocks` edges: `bd create "Epic" -t epic`, `bd create "Task" --parent bd-x`, `bd dep add bd-x.2 bd-x.1`. Or `bd cook feature.formula.toml --var name=... | bd mol pour`.
3. Workers loop: `bd ready --claim --json` → implement → commit with `(bd-id)` → `bd close` → `bd dolt push`. Multiple workers on separate machines/branches are safe (hash IDs, cell-level merge; server mode if they share one DB).
4. Gates hold steps for CI (`gh:run`), PR merge (`gh:pr`), human review (`human`), or another repo's bead.
5. Periodically `bd admin compact` / `bd compact` to keep the DB and `bd prime` output small; `bd doctor` for orphans and drift.

## Notable techniques worth stealing

- `bd ready` semantics (open ∧ no open blockers ∧ not in_progress/blocked/deferred/hooked) + `--claim` atomicity — the minimal correct work-queue for parallel agents.
- Hash IDs with hierarchical suffixes: readable, collision-free, encode the tree.
- Execution hints as structured metadata on the issue (model, effort, parallel group, agent type) that the *orchestrator* reads before spawning.
- `bd prime` on SessionStart, with `.beads/PRIME.md` override and `--memories-only` for post-compaction hooks — "prevent agents from forgetting bd workflow after context compaction."
- Commit-message issue-id trailer + `bd doctor` orphan detection.
- Gate beads for external conditions (CI run, PR merged, timer, cross-repo bead) so waiting is data, not a sleeping process.
- Ephemeral wisps excluded from sync for diagnostics/patrols; `squash` to digest instead of deleting history.
- Storage lives in a side ref (`refs/dolt/data`) — protected branches and PR diffs stay clean.
- CLI design rules in AGENT_INSTRUCTIONS.md: `--json` on every command, prefer flags over new commands, `bd doctor --fix` for all repair.

## Weaknesses / open questions / risks

- Heavy: Dolt embedded in Go; the CLI surface is 80+ commands (the maintainers' own "if we're approaching 30+ commands we have a discoverability problem" rule is long gone). Molecule/formula/wisp vocabulary is Gas-Town-specific jargon.
- Single writer in embedded mode; true parallelism across VMs needs either server mode (a Dolt server reachable from every sandbox) or push/pull discipline with merge risk at the Dolt layer.
- Dolt version pinning and schema-skew guard are operational burdens in ephemeral VMs (must bake the right `bd` into the image).
- Telemetry on by default.
- Fast-moving: docs mention legacy JSONL/SQLite paths, `bd edit` footguns, renamed commands; expect churn.
- No built-in notion of "spec" or acceptance-test artifact beyond free-text `acceptance`/`design` fields.

## Fit for our agentic stack

Beads is the best available answer to "what replaces `IMPLEMENTATION_PLAN.md` when there is more than one VM."

- **Adopt** as the factory's work queue: an epic per PRD/feature, vertical-slice tasks with `blocks` edges (from a `/to-issues`-style planner), workers in cloud VMs doing `bd ready --claim --json` → implement → `bd close`. Map afk-workflow's `ready-for-agent`/`ready-for-human`/`needs-info` onto labels (`bd ready --label ready-for-agent`, and `bd update --label ready-for-human` to escalate).
- **Sync topology for VMs**: simplest is `bd dolt pull` at VM start, `bd dolt push` at end, with `bd ready --claim` inside a short claim window; if we run >2–3 concurrent workers, run `dolt sql-server` on the orchestrator host and use `bd init --server`. Alternatively keep the DB only on the orchestrator and have workers receive a single issue via prompt (Sandcastle style) — Beads then only needs to run on the controller.
- **pi integration**: no `bd setup pi` yet; wire `bd prime --hook-json`'s text into `--append-system-prompt` or an AGENTS.md line, and expose `bd` as a plain CLI skill (pi's "skills beat MCP" stance fits). `beads-mcp` exists if we want it.
- **Use execution metadata** to choose pi `--model`/`--thinking` per task from the orchestrator.
- **Gates** map well to our merge-queue: `gh:run` / `gh:pr` gates hold dependent tasks until CI/merge; `human` gates for `ready-for-human`.
- **Skip for now**: formulas/molecules (over-engineered for a solo dev; revisit if we want reusable "patrol" workflows), Jira/Linear bridges, server mode until needed.

## Related resources mentioned

- Gas Town (Yegge's multi-agent orchestrator built on Beads; "rigs", "polecats", "patrols", `GT_ROOT`) — https://github.com/gastownhall (org); the consumer that explains molecules/gates.
- Dolt — https://github.com/dolthub/dolt (version-controlled SQL DB; pinned 2.2.0).
- `beads-mcp` — https://pypi.org/project/beads-mcp/ MCP server.
- `docs/community-tools.md`, `docs/related-projects.md` in the repo — directories of UIs and adjacent trackers.
- Sandcastle `docs/agents/issue-tracker.md` supports Beads as a tracker (see `factories/sandcastle.md`).

## Key quotes / references

- "Beads provides a persistent, structured memory for coding agents. It replaces messy markdown plans with a dependency-aware graph, allowing agents to handle long-horizon tasks without losing context."
- "Use `bd remember` for persistent project memory; do not create MEMORY.md files. Do not use markdown TODO lists for task tracking."
- "Hash-based IDs (`bd-a1b2`) prevent merge collisions in multi-agent/multi-branch workflows."
- "`.beads/issues.jsonl` is an export for viewers and interchange, not the source of truth or a backup."
- "Parent/orchestrator agents must read these fields before spawning subagents because a running subagent cannot change its model or reasoning effort after launch."

## Gaps

- Did not read `docs/core-concepts/sync-concepts.md`, `protected-branches.md`, or the server-mode multi-writer docs in detail; concurrency guarantees of `--claim` under push/pull (vs server) are inferred, not verified.
- Did not test `bd` locally or inspect the Claude SessionStart hook payload.
- Gas Town itself not researched (candidate for a factory file).
