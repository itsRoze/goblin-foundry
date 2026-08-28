# jspicher/afk-workflow

- **URL:** https://github.com/jspicher/afk-workflow
- **Type:** skills/agents (Claude Code marketplace plugin: 14 skills + `/afk` command + two bash runners) — a packaging of Matt Pocock's "real engineer's" workflow
- **Author/Org:** jspicher (solo); skills vendored from `mattpocock/skills`, runner scripts from `mattpocock/ai-hero-cli` (both MIT)
- **Researched:** 2026-08-26
- **Status/maturity:** 0 stars, MIT (with attribution note), default branch `master`, last push 2026-06-18. One-person adaptation with Windows/Git-Bash fixes. Value is in the *shape* (it is the clearest end-to-end statement of Pocock's day-shift/night-shift loop), not in the community.

## One-paragraph summary

afk-workflow splits work into a human **day shift** (grill → PRD → vertical-slice issues → triage → PR plan) and an autonomous **night shift** (a Ralph loop that, each iteration, spawns a brand-new headless `claude`, hands it the concatenated issue files + last five commits + a fixed `prompt.md`, and expects it to pick one `ready-for-agent` issue, implement it with a strict red-green-refactor `/tdd` skill, pass the repo's pre-commit gate, commit once, and rewrite the issue's `Status:` line plus a dated `## Progress` note). The loop stops on `<promise>NO MORE TASKS</promise>` or the iteration cap. All state lives in a removable `docs/afk-workflow/` directory (config, backlog, context/ADRs, out-of-scope) so the issue tracker can be plain markdown, GitHub, or GitLab.

## Core ideas / thesis

- **Humans plan, agents implement.** Planning skills (`/grill-me`, `/to-prd`, `/to-issues`, `/triage`, `/to-prs`) are interactive and run by day; the night loop only ever consumes already-triaged, fully-specified issues.
- **Vertical slices (tracer bullets) with a DAG.** `/to-issues` produces thin end-to-end slices ("schema, API, UI, tests"), each tagged HITL or AFK, with explicit `## Blocked by` edges. "Prefer many thin slices over few thick ones."
- **Triage is a state machine** with a canonical vocabulary mapped onto whatever labels the repo uses: `needs-triage → {needs-info | ready-for-agent | ready-for-human | wontfix}`, plus `done`. The agent may only move issues to `done`, `ready-for-human`, `ready-for-agent` (partial), `needs-info`; never `needs-triage` or `wontfix`.
- **Fresh session rule.** "start a fresh session for anything that begins a new thread or reads only durable state"; continue in-session only for skills that synthesize the live conversation (`/to-prd`, `/zoom-out`). "The night shift is fresh-by-design: every `afk.sh` iteration spawns a brand-new `claude` whose only memory is the issue *files*."
- **Backpressure from the repo, not the loop.** Prompt tells the agent to find the pre-commit gate in `CLAUDE.md`/`AGENTS.md`/`package.json`/CI and make it all pass; "the agent codes blind without one."
- **One commit per issue** so review is `git log master..HEAD` + `git show`; `/to-prs` turns the DAG into an ordered `PR-PLAN.md` of PR-sized batches so nights don't produce one unreviewable PR or N stacked ones.

## Architecture & mechanics

### Plugin layout
```
afk-workflow/
├── .claude-plugin/{marketplace.json,plugin.json}
├── commands/afk.md            # /afk — one in-session iteration
├── scripts/{once.sh,afk.sh,prompt.md}
├── docs/{triage-labels.md,to-prs-spec.md}
└── skills/  grill-me  grill-with-docs(+ADR-FORMAT,CONTEXT-FORMAT)  to-prd  to-issues  triage(+AGENT-BRIEF,OUT-OF-SCOPE)
             to-prs  qa  tdd(+deep-modules,interface-design,mocking,refactoring,tests)  diagnose(+hitl-loop.template.sh)
             improve-codebase-architecture  zoom-out  caveman  write-a-skill  setup-afk-skills(+domain,issue-tracker-{github,gitlab,local},triage-labels)
```

### What it writes into a consuming repo
```
docs/afk-workflow/
├── config/    issue-tracker.md, triage-labels.md, domain.md   (from /setup-afk-skills)
├── scripts/   once.sh, afk.sh, prompt.md                        (copied runners)
├── backlog/   <feature>/PRD.md, <feature>/issues/NN-<slug>.md   (/to-prd, /to-issues)
├── context/   CONTEXT.md / CONTEXT-MAP.md                       (glossary, from /grill-with-docs)
├── adr/       0001-*.md
└── out-of-scope/ <concept>.md                                   (rejected features, from /triage)
```
plus an `## Agent skills` pointer block in `CLAUDE.md`/`AGENTS.md`. Local-markdown tracker convention: `Status:` line near the top of each issue file; comments appended under `## Comments`.

### The loop (`scripts/afk.sh <max_iterations> [issues_glob]`)
```bash
for ((i=1; i<=MAX_ITERATIONS; i++)); do
  issues=$(cat $ISSUES_GLOB 2>/dev/null || echo "No issues found")
  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short)
  prompt=$(cat "$SCRIPT_DIR/prompt.md")
  claude --dangerously-skip-permissions --verbose --print --output-format stream-json \
    <<< "Previous commits: $commits
$issues
$prompt" \
  | grep --line-buffered '^{' | tee "$tmpfile" \
  | jq --unbuffered -rj 'select(.type=="assistant").message.content[]? | select(.type=="text").text // empty'
  result=$(jq -r 'select(.type=="result").result // empty' "$tmpfile")
  [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]] && exit 0
done
echo "Iteration limit reached ($MAX_ITERATIONS). Sentinel not detected -- backlog may still have ready-for-agent issues."
```
Notes baked into the script: prompt via stdin here-string (Windows 32 KB argv cap); `--print` is "load-bearing" (bare `claude` on a pipe hangs trying to open the TUI); `HONCHO_ENABLED=false` because a memory plugin's SessionEnd hook got killed every iteration and re-sent its queue; no Docker wrapper (Pocock's original used `docker sandbox run claude`) so "RUN ON A DEDICATED BRANCH OR GIT WORKTREE". `once.sh` = one iteration, for smoke testing before trusting the loop.

### `scripts/prompt.md` (the night-shift prompt, abridged)
```
# ISSUES
Issue files are provided at the start of context as concatenated markdown ... You will work on the AFK
issues only -- those whose `Status:` line is `ready-for-agent`. Skip any issue in any other canonical state ...
You've also been passed the last few commits. Review these to understand what work has been done.
If all AFK tasks are complete, output <promise>NO MORE TASKS</promise>.

# TASK SELECTION
Pick the next task. Prioritize tasks in this order:
1. Critical bugfixes  2. Development infrastructure  3. Tracer bullets for new features
4. Polish and quick wins  5. Refactors

# EXPLORATION
Explore the repo. See `CLAUDE.md` / `AGENTS.md` for architecture, conventions, and the project's
design-system primitives and shared utilities before writing new code.

# IMPLEMENTATION
Use the `/tdd` skill (red-green-refactor). ... RED: Write a single failing test / GREEN: minimal implementation / RED: another failing test ...

# FEEDBACK LOOPS
Before committing, run the project's full pre-commit gate. ... type check, lint, unit tests, build. All gate steps must pass. If any fail, fix or revert before committing.

# COMMIT
... commit message must: 1. Include key decisions made 2. Include files changed 3. Blockers or notes for next iteration

# THE ISSUE FILE
Always update the issue file's `Status:` line and append a `## Progress` note (with a date stamp) ...
You may set: done | ready-for-human | ready-for-agent (partial; use sparingly) | needs-info
You must NEVER set: needs-triage | wontfix
The <promise>NO MORE TASKS</promise> sentinel should only fire when zero issues remain in `ready-for-agent` state.

# FINAL RULES
ONLY WORK ON A SINGLE TASK.
```

### Issue template (from `/to-issues`)
```
## Parent            (ref to parent issue, optional)
## What to build     (end-to-end behavior of the slice, not layer-by-layer)
## Acceptance criteria   - [ ] ...
## Blocked by        (ref) or "None - can start immediately"
```
`/to-issues` quizzes the user on granularity, dependency correctness, merge/split, HITL vs AFK before publishing (blockers first so real IDs can be referenced). `/triage` requires reproduction for bugs before grilling, posts an "agent brief" comment when moving to `ready-for-agent`, and writes `wontfix` enhancements into `out-of-scope/` so future triage can cite prior rejections. `/to-prs` reads *whole* issue bodies for dependency edges ("a parser keyed on one heading would miss edges"), infers a risk tier (auth/payment/migration/delete → high/critical), and emits an ordered batch plan that "doubles as the night-shift batch schedule."

## Workflow: end to end

1. `/setup-afk-skills` (once per repo): choose tracker (GitHub/GitLab/local md), label vocabulary, domain-doc layout; scaffolds `docs/afk-workflow/config/*`, copies runners, adds the CLAUDE.md block.
2. Day: `/grill-me` or `/grill-with-docs` (one-question-at-a-time interview; writes `CONTEXT.md` + ADRs as decisions land) → `/to-prd` (same session) → `/to-issues` (fresh, from PRD.md) → `/triage` to `ready-for-agent` → `/to-prs` for `PR-PLAN.md`.
3. Night, on a throwaway branch: `bash docs/afk-workflow/scripts/once.sh "$GLOB"` (smoke) → `bash docs/afk-workflow/scripts/afk.sh 30 "$GLOB"`.
4. Morning: `grep -rn "^Status:" docs/afk-workflow/backlog/` to find `ready-for-human`/`needs-info`; `git log --oneline master..HEAD`; `git show` per commit; open PR(s) per `PR-PLAN.md`; resolve flagged issues; re-queue fixes by flipping `Status:` back to `ready-for-agent` with a Progress note, or `/qa` + `/triage` for genuinely new slices.

## Notable techniques worth stealing

- Concatenate *all* open issue files + last 5 commits into the prompt so the agent (not the loop) picks the next unblocked task. Cheap, no tracker API, works offline. Falls over past a few dozen issues (see risks).
- `Status:` line as machine-readable state inside a human-readable markdown issue; `## Progress` notes with date stamps as the cross-iteration journal.
- Explicit *allowed* vs *forbidden* status transitions for the agent; escalate via `ready-for-human` with a reason instead of letting the agent close as wontfix.
- Priority ladder in the prompt: bugfix > dev infra > tracer bullet > polish > refactor ("getting tests and types and dev scripts ready is an important precursor to building features").
- Sentinel is checked only against the `result` event, and only fires when zero `ready-for-agent` issues remain — `needs-info`/`ready-for-human` do not block loop exit.
- `once.sh` before `afk.sh` — always smoke-test one iteration.
- Out-of-scope knowledge base so triage can say "we rejected this before, here's why."
- `/to-prs` as the bridge between "one commit per issue on one branch" and reviewable PRs; re-runnable as batches merge.
- Commit message contract: decisions, files, blockers/notes for the next iteration (the next fresh agent reads `git log -n 5`).

## Weaknesses / open questions / risks

- Context cost grows linearly with backlog size (every issue body, every iteration). No `bd ready`-style filtering; the agent must ignore non-ready issues itself.
- No isolation: replaced Pocock's Docker sandbox with "use a branch." Fine for a hobby repo, not for a factory.
- Serial by construction — one agent, one branch, one task at a time. Parallelism would need worktrees + claim semantics the markdown `Status:` line cannot provide atomically.
- Local-markdown tracker means issue state is committed alongside code; merge conflicts on `Status:` lines if two branches touch the same issue.
- Zero stars / single maintainer; upstream skills (`mattpocock/skills`) will drift.
- Windows-centric workarounds (WSL re-exec, argv cap) add noise.
- Claude-Code-specific (`--print --output-format stream-json`, `/tdd` skill invocation by slash name).

## Fit for our agentic stack

Strong fit as the *template* for our night-shift loop; near-direct port to pi.

- **Runner**: replace the `claude` invocation with `pi --mode json -p --no-session --append-system-prompt "$(cat prompt.md)" <<< "$issues"` and detect the sentinel in the final assistant text of the JSONL. pi print mode merges piped stdin into the prompt, so the here-string trick carries over unchanged.
- **Tracker**: keep the day-shift skills' *outputs* (PRD, vertical-slice issues with Blocked-by, triage vocabulary, PR-PLAN) but store the backlog in Beads instead of concatenated markdown once we run more than one VM: `bd ready --claim --json` replaces "read every issue and pick," and `bd close` / `bd update --notes` replaces the `Status:` line. Keep the `## Progress` note idea as `bd comment`.
- **Skills**: `tdd`, `diagnose`, `to-issues`, `triage`, `to-prs` are plain SKILL.md files and load into pi's `.agents/skills` unchanged (drop the `/tdd` slash reference; pi skills are invoked by name in the prompt).
- **Isolation**: one cloud VM per night-shift run (or per issue when parallel), branch per issue, VM torn down after push — restores the Docker boundary this plugin dropped.
- **Adopt verbatim**: allowed/forbidden status transitions, priority ladder, commit-message contract, `once.sh`-then-`afk.sh`, sentinel-only-when-zero-ready.
- **Skip**: Windows shims, Honcho env var, local-markdown tracker for anything beyond a single-VM experiment.

## Related resources mentioned

- https://github.com/mattpocock/skills — upstream of the 14 skills (already covered in `skills-agents/mattpocock-skills.md`).
- `mattpocock/ai-hero-cli` `ralph/afk.sh` + `ralph/once.sh` — the original Linux runners (with `docker sandbox run claude`); worth diffing against this port.
- https://github.com/mattpocock/sandcastle — Pocock's sandboxed successor (see `factories/sandcastle.md`).
- `skills/diagnose/scripts/hitl-loop.template.sh` — a human-in-the-loop debugging loop template; not inspected.

## Key quotes / references

- "The single rule: **start a fresh session** for anything that begins a new thread ... or reads only durable state."
- "every `afk.sh` iteration spawns a brand-new `claude` whose only memory is the issue *files*."
- "The night shift (`afk.sh`) emits **one atomic commit per issue onto one branch**. It has no notion of how those commits should become pull requests."
- "The `<promise>NO MORE TASKS</promise>` sentinel should only fire when zero issues remain in `ready-for-agent` state."
- "ONLY WORK ON A SINGLE TASK."

## Gaps

- Did not read `to-prs-spec.md`, `AGENT-BRIEF.md`, `hitl-loop.template.sh`, or the `tdd` reference files in detail.
- Did not diff against `mattpocock/ai-hero-cli` originals (repo not fetched).
