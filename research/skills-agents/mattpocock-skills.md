# mattpocock/skills ("Skills For Real Engineers")

- **URL:** https://github.com/mattpocock/skills
- **Type:** skills/agents
- **Author/Org:** Matt Pocock (Total TypeScript / AI Hero, aihero.dev)
- **Researched:** 2026-08-26
- **Status/maturity:** ~237.9k stars, ~20.2k forks, MIT. Created 2026-02-03; last push 2026-08-24; 150+ commits on main in the last ~6 weeks alone; 415 open issues/PRs. Releases via changesets: v1.0.0 (June), v1.1.0 (2026-07-08), v1.2.0/1.2.2 (2026-08-05), v1.2.3 (2026-08-06); `plugin.json` version 1.2.3. Listed in Claude Code's **official plugin marketplace** (`claude plugins install mattpocock-skills`) since 2026-08-05. Also installable via `npx skills@latest add mattpocock/skills` (Agent Skills standard; works in Codex and others). Very active, single maintainer plus community PRs.

## One-paragraph summary

A curated set of ~37 Agent-Skills-format `SKILL.md` folders that Pocock uses daily, split into promoted buckets (`engineering/` 18 skills, `productivity/` 7 skills, shipped in the plugin), `misc/` (4, unpromoted), `in-progress/` (8, beta, not in plugin), and `deprecated/` (empty). The skills are small prompt documents, mostly under 100 lines, that encode classic engineering discipline (Pragmatic Programmer, DDD, XP, Ousterhout's deep modules, Fowler's smells) as repeatable agent process: grill the human until requirements are resolved, build a shared domain language (`CONTEXT.md` + ADRs), turn conversations into specs and tracer-bullet tickets with blocking edges on a real issue tracker, implement via red-green TDD at pre-agreed seams, review on two independent axes (standards vs spec), diagnose bugs via a tight red feedback loop first. The repo is also a worked example of *how to write skills*: it has an explicit user-invoked vs model-invoked taxonomy, a router skill, ADRs about its own packaging, and a `writing-for-agents` reference on context pointers, leading words, and progressive disclosure.

## Core ideas / thesis

- **Fix the failure modes, don't own the process.** "Approaches like GSD, BMAD, and Spec-Kit try to help by owning the process. But while doing so, they take away your control and make bugs in the process hard to resolve. These skills are designed to be small, easy to adapt, and composable." Four named failure modes: (1) the agent didn't do what I want → grilling; (2) the agent is too verbose → shared language (`CONTEXT.md`); (3) the code doesn't work → feedback loops (TDD, diagnosis); (4) we built a ball of mud → codebase design / deep modules.
- **Alignment before code.** Grilling is the headline: interview the user in rounds over a "design tree" until every branch is resolved. Facts are the agent's job, decisions are the user's.
- **Ubiquitous language as a token and quality lever.** `CONTEXT.md` glossary + ADRs make the agent terser, name things consistently, and navigate better.
- **Tracer bullets and vertical slices.** Tickets cut a complete path through every layer, are demoable alone, and sized to one fresh context window; blocking edges make a **frontier** of grabbable work.
- **Feedback loops are the speed limit.** TDD skill and diagnosing-bugs skill both refuse to proceed without a red-capable signal.
- **Two-load model for agent docs.** Every document spends either *context load* (always-loaded tokens) or *cognitive load* (the human must remember it). User-invoked skills spend cognitive load; model-invoked ones spend context load. Pick deliberately.
- **Harness-neutral but Claude-first.** Every skill has Claude Code frontmatter plus `agents/openai.yaml` for Codex; cross-skill calls are phrased as `Call the Skill tool with "grilling"` so they fire in any harness.

## Architecture & mechanics

### Repo layout

```
skills/
  engineering/<name>/SKILL.md [+ reference .md files, scripts/, template.sh]
  productivity/<name>/SKILL.md
  misc/<name>/SKILL.md
  in-progress/<name>/SKILL.md
  deprecated/README.md            # empty by policy: retired skills are deleted, changeset names the replacement
  */README.md                     # bucket index, User-invoked vs Model-invoked
  <every skill>/agents/openai.yaml  # Codex UI metadata + policy.allow_implicit_invocation
.claude-plugin/plugin.json        # explicit `skills: [...]` array = the promoted set (25 entries)
.claude-plugin/marketplace.json   # repo as its own single-plugin marketplace (fallback)
.agents/invocation.md             # user-invoked vs model-invoked rules
.agents/writing-docs.md           # docs page template (What it does / When to reach for it / Common questions / It's working if)
.agents/install-block.md          # canonical install text
.agents/adr/0001-*.md, 0002-*.md  # ADRs about the repo itself
.out-of-scope/*.md                # rejected feature requests as a knowledge base (used by /triage)
docs/engineering/*.md, docs/productivity/*.md   # human docs, published at aihero.dev/skills-<name>
CLAUDE.md (AGENTS.md -> symlink)  # repo rules: promoted-bucket invariants, no em-dashes, router must stay in sync
CONTEXT.md                        # the repo's own domain glossary (Issue tracker, Issue, Decision ticket, Triage role)
scripts/link-skills.sh            # dev-only: symlink every skill into ~/.claude/skills and ~/.agents/skills
scripts/sync-plugin-version.mjs   # keep plugin.json version == package.json version
.changeset/                       # changesets → CHANGELOG.md + GitHub release
```

### Invocation model (`.agents/invocation.md`)

- **User-invoked**: `disable-model-invocation: true` in frontmatter (Claude Code) and `policy.allow_implicit_invocation: false` in `agents/openai.yaml` (Codex). Description is human-facing. Only the human can fire it; **no other skill can call it**. These are orchestrators.
- **Model-invoked**: default. Description is model-facing with trigger phrasing. Holds reusable discipline. Can be called by user or by other skills via `Call the Skill tool with "<name>"` (one skill per call; two skills = two calls).
- Shared reference two user-invoked skills both need must live in a plain file outside the skill system.
- Router skill (`ask-matt`) exists because user-invoked skills pile up cognitive load.

### Per-repo configuration (`/setup-matt-pocock-skills`)

Run once per repo. Explores `git remote`, `CLAUDE.md`/`AGENTS.md`, `CONTEXT.md`, `docs/adr/`, `.scratch/`, monorepo signals; then writes:
- `docs/agents/issue-tracker.md` (GitHub via `gh`, GitLab via `glab`, local markdown under `.scratch/<feature>/`, or freeform "other" e.g. Linear/Jira). Seed templates: `issue-tracker-github.md`, `issue-tracker-gitlab.md`, `issue-tracker-local.md`.
- `docs/agents/triage-labels.md` mapping canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) to real label strings (only if `triage` installed).
- `docs/agents/domain.md` (single-context `CONTEXT.md` + `docs/adr/`, or multi-context `CONTEXT-MAP.md`).
- An `## Agent skills` block in the existing `CLAUDE.md` or `AGENTS.md` pointing at those three files.
ADR 0001: only hard-dependency skills (`to-tickets`, `to-spec`, `triage`) carry the explicit "run `/setup-matt-pocock-skills` if not" pointer; soft-dependency skills (`tdd`, `diagnosing-bugs`, `improve-codebase-architecture`) just say "the project's domain glossary" and degrade gracefully.

### Grilling primitive (`skills/productivity/grilling/SKILL.md`, model-invoked)

Works a **design tree** in **rounds**; the **frontier** is every decision whose prerequisites are settled. Ask the whole frontier per round, numbered, each with a recommended answer, separated by `---`:
```
❓ **Q1** - **<question title>**: <body, may include multiple choices>
➡️ <your recommended answer>
```
No hard cap on questions (`.out-of-scope/question-limits.md` explicitly rejects one). `grill-me` is literally `Call the Skill tool with "grilling".`; `grill-with-docs` is `Call the Skill tool twice, for "grilling" and "domain-modeling".`

### Full skill inventory

Legend: **U** = user-invoked (`disable-model-invocation: true`), **M** = model-invoked. "CC" = usable in Claude Code as-is (all SKILL.md files are valid Claude Code skills; column notes practical caveats).

**engineering/ (promoted, in plugin)**

| Skill | Inv | One line | CC |
|---|---|---|---|
| `ask-matt` | U | Router: maps the main flow (grill-with-docs → prototype detour → to-spec → to-tickets → implement/tdd/code-review), on-ramps (triage, diagnosing-bugs, wayfinder), codebase health, vocabulary layers, phase boundaries. Has `PHASE-BOUNDARIES.md`. | Yes |
| `grill-with-docs` | U | Grilling + domain-modeling: stateful interview that updates `CONTEXT.md` and ADRs inline. Pocock's "single coolest technique". | Yes |
| `triage` | U | State machine over issues/external PRs (`needs-triage` → `needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`); redundancy + prior-rejection checks; verify claim; grill; writes agent briefs (`AGENT-BRIEF.md`) and `.out-of-scope/` entries (`OUT-OF-SCOPE.md`). Every posted comment starts `> *This was generated by AI during triage.*` | Yes, needs `gh`/`glab` + setup |
| `improve-codebase-architecture` | U | Survey for deep-module "deepening opportunities", render as HTML report (`HTML-REPORT.md`), grill through the chosen one. | Yes |
| `setup-matt-pocock-skills` | U | Per-repo config wizard (issue tracker, triage labels, domain docs). Precondition for engineering flows. | Yes |
| `to-spec` | U | Synthesize the current conversation into a spec and publish to the issue tracker; no interview. | Yes, needs setup |
| `to-tickets` | U | Break spec/plan into tracer-bullet vertical slices with **blocking edges**; expand-contract sequencing for wide refactors; quiz the user on granularity; publish as native blocking links (GitHub/Linear) or `.scratch/<feature>/issues/NN-slug.md`; label `ready-for-agent`. | Yes, needs setup |
| `implement` | U | 7 lines: implement spec/tickets, use `/tdd` at pre-agreed seams, typecheck often, `/code-review` at end, commit to current branch. | Yes |
| `wayfinder` | U | "Fog of war" planning for work bigger than one session: a `wayfinder:map` issue (Destination / Notes / Decisions so far / Not yet specified / Out of scope) with child **decision tickets** typed `research` (AFK) / `prototype` (HITL) / `grilling` (HITL) / `task`; claim by assignee; native blocking; one ticket per session; hands off to `/to-spec` when the way is clear. | Yes, needs tracker with native blocking (GitHub sub-issues, Linear) |
| `prototype` | M | Throwaway prototype to answer one design question: single shareable HTML file for state/logic (`LOGIC.md`) or several toggleable UI variants (`UI.md`); kept on a `prototype/<name>` branch as a primary source. | Yes |
| `diagnosing-bugs` | M | 5-phase loop: build a tight red-capable feedback loop (10 ranked ways incl. `scripts/hitl-loop.template.sh`) → reproduce + minimise → 3-5 falsifiable hypotheses shown to user → instrument one variable at a time with tagged `[DEBUG-xxxx]` logs → fix + regression test. Redact secrets first. | Yes |
| `research` | M | Spawn a background agent to investigate against primary sources and write a cited Markdown file in the repo. | Yes (uses Agent tool) |
| `tdd` | M | Red → green at **pre-agreed seams** only; vertical slices; anti-patterns (implementation-coupled, tautological, horizontal slicing); refactoring belongs to review, not the loop. `tests.md`, `mocking.md`. | Yes |
| `domain-modeling` | M | Actively challenge terms against the glossary, stress-test with edge cases, write `CONTEXT.md` (`CONTEXT-FORMAT.md`) and ADRs (`ADR-FORMAT.md`) inline. | Yes |
| `codebase-design` | M | Vocabulary reference for deep modules: module, interface, depth, seam, adapter, leverage, locality. `DEEPENING.md`, `DESIGN-IT-TWICE.md`. | Yes |
| `code-review` | M | Diff since a fixed point (`git diff <ref>...HEAD`), two **parallel sub-agents**: Standards (repo standards + 12 Fowler smells baseline, repo overrides baseline) and Spec (missing/creep/wrong vs originating issue). Reports kept separate, never reranked across axes. | Yes (harness-neutral sub-agent wording since 1.2.3) |
| `resolving-merge-conflicts` | M | Resolve hunk by hunk by intent traced to each side's primary source; finish the operation; never `--abort`. | Yes |
| `wizard` | M | Generate an interactive bash wizard (`template.sh`: stages, confirmation gates, URL opening incl. WSL, hidden secret entry, `.env` upserts, `gh secret` writes, shellcheck) for steps only a human can do. | Yes |

**productivity/ (promoted, in plugin)**

| Skill | Inv | One line | CC |
|---|---|---|---|
| `grill-me` | U | Stateless grilling (`Call the Skill tool with "grilling"`). | Yes |
| `grilling` | M | The interview primitive (rounds, frontier, recommended answers). | Yes |
| `handoff` | U | Compact conversation into a handoff doc in the OS temp dir; "suggested skills" section; reference artifacts by path, don't duplicate; redact secrets. `argument-hint` supported. | Yes |
| `teach` | U | Multi-session teaching workspace in the current dir (`MISSION-FORMAT.md`, `LEARNING-RECORD-FORMAT.md`, `GLOSSARY-FORMAT.md`, `RESOURCES-FORMAT.md`). | Yes |
| `to-questionnaire` | U | Turn a decision someone else must answer into a Markdown questionnaire; grills you about the *send*, not the subject. | Yes |
| `wait-what` | U | Three-line corrective: re-pitch the last message in plain English using `CONTEXT.md` vocabulary. Follows `CONTEXT-MAP.md` in multi-context repos. | Yes |
| `writing-for-agents` | M | Reference for writing skills / AGENTS.md / pointed-at docs: context pointers, two loads, information hierarchy, progressive disclosure, completion criteria, leading words, negation failure, pruning/no-ops. `SKILL-MECHANICS.md` covers frontmatter, invocation choice, router skills. | Yes |

**misc/ (kept, not promoted, not in plugin)**

| Skill | Inv | One line | CC |
|---|---|---|---|
| `git-guardrails-claude-code` | M | Installs a `PreToolUse` hook on `Bash` (`scripts/block-dangerous-git.sh`, exits 2 with `BLOCKED:` on stderr) blocking `git push`, `reset --hard`, `clean -f`, `branch -D`, `checkout .`, `restore .`. | Yes, Claude Code specific |
| `migrate-to-shoehorn` | M | Replace `as` casts in tests with `@total-typescript/shoehorn`. | Yes (TS only) |
| `scaffold-exercises` | M | Scaffold course exercise directories. | Yes (niche) |
| `setup-pre-commit` | M | Husky + lint-staged + Prettier + typecheck + tests. | Yes (JS/TS) |

**in-progress/ (beta, public, not in plugin; install with `npx skills@latest add mattpocock/skills --skill=<name>`)**

| Skill | Inv | One line | CC |
|---|---|---|---|
| `implement-spec` | U | Implement a whole spec on one branch: treat tickets as a **task graph**, run **implementer subagents in the background across the ready frontier**, each in its own worktree/branch; merger subagent folds each into the PR branch; re-scan the frontier; `/code-review` at end; ready for review; clean worktrees. Communicate via context pointers only. | Yes (Agent tool + worktrees) |
| `claude-handoff` | U | Handoff summary launched directly as `claude --bg --name "<name>" "<summary>"`. | Yes, Claude Code specific |
| `loop-me` | U | Grill yourself into implementable workflow specs across sessions, stateful workspace. | Yes |
| `retro` | U | STUB: post-session retrospective proposing environment improvements (navigation pointers, automated checks, coding standards for the reviewer, AGENTS.md hygiene, tool economy, no-ops, information access). Encodes the "implementation agent has context pressure, review agent enforces standards" split. | Yes (design notes) |
| `setup-ts-deep-modules` | U | Wire dependency-cruiser so each package is a deep module (`dependency-cruiser.config.cjs`). | Yes (TS only) |
| `writing-beats` / `writing-fragments` / `writing-shape` | U | Article-writing explore/exploit trio. | Yes, not engineering |

Frontmatter used: `name`, `description`, `disable-model-invocation`, `argument-hint`. No `allowed-tools`, no `model`, no hooks inside skills (except the guardrails skill which *installs* a hook). All descriptions with colons are quoted (fix in 1.2.3 for YAML).

## Workflow: end to end

The "main flow: idea → ship" from `ask-matt`:

1. `/setup-matt-pocock-skills` once per repo (tracker, labels, `CONTEXT.md`/ADR layout).
2. `/grill-with-docs` in one unbroken context window: rounds of numbered questions with recommendations; `CONTEXT.md` and ADRs updated inline as decisions land. Stay under the "smart zone" (~150k tokens); `/compact` only at a phase boundary.
3. If a question needs a runnable answer: `/handoff` → fresh session → `/prototype` (single HTML file or UI variants, kept on `prototype/<name>`) → `/handoff` back.
4. Multi-session build? `/to-spec` publishes the spec as an issue; `/to-tickets` splits it into tracer-bullet tickets with blocking edges (native GitHub/Linear links or `.scratch/<feature>/issues/NN-slug.md`), labelled `ready-for-agent`.
5. Per ticket, fresh context: `/implement` → drives `/tdd` (agree seams first, red → green per slice, typecheck often) → `/code-review` (Standards + Spec sub-agents against the originating issue) → commit. `/clear` between tickets.
6. Beta alternative for whole-spec AFK execution: `/implement-spec` fans out background implementer subagents over the ready frontier in worktrees, merges each, single draft PR, review, ready.
7. On-ramps feeding step 2/5: `/triage` turns raw issues/PRs into agent-ready briefs (or `.out-of-scope/` rejections); `/diagnosing-bugs` for hard bugs; `/wayfinder` for foggy multi-session efforts that end at `/to-spec`.
8. Upkeep: `/improve-codebase-architecture` every few days; `/retro` (stub) to improve the agent environment.

No CI/merge automation is included; "ship" ends at commit/PR.

## Notable techniques worth stealing

- **Rounds-over-a-frontier grilling format** (`Q1` + `➡️ recommended answer`, ask the whole frontier per round). Cheap to adopt, high alignment payoff. Recommended answers let the human accept in one word.
- **User-invoked vs model-invoked split with the "can no other skill call it" invariant**, and the `Call the Skill tool with "x"` phrasing for dependencies. This is the cleanest skill-composition convention seen so far and maps 1:1 onto Claude Code's `disable-model-invocation`.
- **Router skill** (`ask-matt`) as the antidote to cognitive load once you have >10 user-invoked skills. Keep it in sync by rule (CLAUDE.md says "a router that lies").
- **Hard vs soft dependency pointers** (ADR 0001): only skills that break without config get the "run setup" line.
- **Tickets with blocking edges → frontier** as the interface between planning and execution; `implement-spec`'s "task graph, not a list" + background subagents + worktrees + merger subagent is a compact AFK executor design. Pairs with fusion-harness's DAG JSON.
- **Two-axis code review in parallel sub-agents, never reranked.** Standards (with a fixed Fowler smell baseline the repo can override) vs Spec fidelity (missing / scope creep / wrong). "Skip anything tooling already enforces."
- **Reviewer enforces standards, implementer doesn't** (retro skill): the implementer has the most context pressure, the reviewer gets a diff and can afford rules. Put `CODING_STANDARDS.md` on the review path, keep `CLAUDE.md` for navigation pointers.
- **TDD at pre-agreed seams only; refactoring is review's job, not the loop's.** Prevents the agent from testing everything and from refactoring mid-slice.
- **Feedback loop first, hypotheses later** (diagnosing-bugs): "No red-capable command, no Phase 2." Ten ordered ways to build a loop, tagged debug logs for one-grep cleanup, HITL bash template when a human must click.
- **`CONTEXT.md` ubiquitous-language glossary + ADRs, updated inline during grilling.** Named as a token-efficiency and navigation lever, not just documentation.
- **`.out-of-scope/` knowledge base** consulted by triage so rejected requests aren't re-litigated.
- **`writing-for-agents` heuristics**: context pointers with front-loaded trigger words, one trigger per branch; leading words (`tight`, `red`, `frontier`, `fog of war`) instead of restated sentences; positive phrasing over negation; no-op hunting; environment as source of truth (don't cache `package.json` scripts in docs); progressive disclosure by branch.
- **Repo hygiene for a skills repo**: bucketed promotion, explicit `plugin.json` skills array, `agents/openai.yaml` twin metadata, changesets + version sync script, docs page template with "It's working if", `link-skills.sh` symlinks for local dev, no em-dash rule.
- **Git guardrails hook** (`exit 2` + stderr message) as the minimal PreToolUse safety pattern.
- **`claude --bg --name` handoff** to spawn a fresh background Claude Code session seeded with a summary.

## Weaknesses / open questions / risks

- **Human-in-the-loop by design.** Grilling, wayfinder (HITL ticket types), to-tickets' approval quiz, and phase-boundary decisions assume an engaged human. The AFK pieces (`research`, `implement`, `implement-spec`) are thin; `implement` is 7 lines and `implement-spec`/`retro` are beta/stub.
- **No executable definition of done.** Acceptance criteria are checkbox prose in tickets; verification relies on TDD + review, not a machine-checked gate (contrast fusion-harness).
- **Tracker coupling.** The engineering flow needs `docs/agents/issue-tracker.md` and a tracker with native blocking for wayfinder; Linear/Jira are "other, describe in a paragraph". `.out-of-scope/mainstream-issue-trackers-only.md` says niche trackers won't be added.
- **Volatility.** 150 commits in 6 weeks, v1 → v1.2 renamed/graduated several skills; the official marketplace pin lags `main` by commits, so plugin users can see stale skill lists.
- **Popularity ≠ evaluation.** No evals, no measured outcomes; efficacy claims are anecdotal (Pocock's own use, community posts). 415 open issues suggests support load exceeds capacity.
- **Prose density.** Some skills (`wayfinder` ~12k chars, `writing-for-agents` ~11k, `ask-matt` ~11k) are long for always-loaded or frequently-loaded prompts; the repo's own advice on sprawl applies to itself.
- **JS/TS lean** in misc/in-progress (shoehorn, Husky, dependency-cruiser), though the promoted set is language-agnostic.
- **Plugin vs skills.sh duplication trap**: installing both yields every skill twice.

## Fit for our agentic stack

Very high fit; this is the closest thing to a ready-made "process layer" for a Claude Code factory, and it is already an official plugin.

- **Adopt as-is (plugin):** `grilling`/`grill-with-docs`, `domain-modeling` + `CONTEXT.md`/ADR convention, `to-spec`, `to-tickets`, `tdd`, `code-review`, `diagnosing-bugs`, `handoff`, `writing-for-agents`, `wizard`, `resolving-merge-conflicts`. Run `/setup-matt-pocock-skills` in each factory repo and point the issue tracker at whatever the factory's intake is (GitHub Issues or Linear via the "other" prose path).
- **Adopt the conventions for our own skills:** user-/model-invoked split, `Call the Skill tool with` dependency phrasing, router skill, hard/soft setup pointers, bucketed promotion + explicit `plugin.json`, changesets. Our skill repo should look like this one structurally.
- **Adapt (fork the in-progress ones):** `implement-spec` is the seed of our AFK executor: ticket graph → ready frontier → background implementer subagents in worktrees → merger subagent → single PR → `/code-review`. Extend with (a) a fusion-harness-style executable gate per ticket, (b) writer-lease/worktree discipline, (c) hooks-based observability. `retro` is a good spec for a post-run "improve the environment" job; implement it.
- **Adapt:** `triage` state machine (`needs-triage` → `ready-for-agent`) is a natural intake queue for the factory; wire the `ready-for-agent` label to trigger the executor. `wayfinder` maps for large epics feeding `to-spec`.
- **Combine with fusion-harness:** Pocock supplies alignment, decomposition, and review; Disler supplies machine-checked done-ness and single-writer safety. Tickets from `to-tickets` (with acceptance criteria) are the input a validator agent needs to write a gate.
- **Skip:** `teach`, writing-* trio, `scaffold-exercises`, `migrate-to-shoehorn` (not factory-relevant); `git-guardrails` is superseded by a proper permissions/hook policy but its script is a fine template.
- **Watch:** `wayfinder` tracker support, whether `implement-spec` graduates, and any move toward native Codex plugin (ADR 0002) that changes the repo layout.

## Related resources mentioned

- Agent Skills spec, https://agentskills.io and https://github.com/agentskills/agentskills: the open SKILL.md standard (originated by Anthropic) all of this relies on.
- skills.sh / `npx skills` (vercel-labs/skills), https://skills.sh and https://github.com/vercel-labs/skills: universal installer/registry; `npx skills add mattpocock/skills --skill=<name>`, `npx skills update`.
- Claude Code plugins docs, https://code.claude.com/docs/en/plugins, and the official marketplace repo `anthropics/claude-plugins-official`: how the plugin is distributed; `claude plugin validate . --strict`.
- Pocock's docs pages, `https://aihero.dev/skills-<skill-name>` (e.g. `aihero.dev/skills-grill-me`), and the "AI coding dictionary" (`aihero.dev/ai-coding-dictionary/smart-zone`).
- Community write-ups: latent.space on `/wayfinder` (https://www.latent.space/p/wayfinder-skill); skillselion map of intended flow and deprecations (https://skillselion.com/guides/matt-pocock-skills-map); andrew.ooo review; Devtalk week-long trial thread.
- Pocock's YouTube "Things People Get Wrong With My /grill-* skills" (May 2026) and X posts on `/wayfinder` replacing `/grill-with-docs` as an orchestrator for big efforts.
- Named competitors in the README: GSD, BMAD, Spec-Kit (process-owning frameworks) — worth a comparison file.
- Example `CONTEXT.md` from `mattpocock/course-video-manager` (linked in README).
- Books that underpin the skills: Pragmatic Programmer, DDD (Evans), XP Explained (Beck), A Philosophy of Software Design (Ousterhout), Refactoring ch.3 (Fowler).
- `@total-typescript/shoehorn`, dependency-cruiser (TS tooling referenced by misc/in-progress skills).

## Key quotes / references

- "Approaches like GSD, BMAD, and Spec-Kit try to help by owning the process. But while doing so, they take away your control and make bugs in the process hard to resolve." (README)
- "There is a communication gap between you and the agent. The fix for this is a grilling session." (README)
- "It's hard to explain how powerful this is. It might be the single coolest technique in this repo." (README, on `grill-with-docs` + shared language)
- "A user-invoked skill may invoke model-invoked skills, but never another user-invoked one." (README / `.agents/invocation.md`)
- "Test only at pre-agreed seams. ... Refactoring is not part of the loop. It belongs to the review stage." (`tdd/SKILL.md`)
- "This is the skill. Everything else is mechanical. ... No red-capable command, no Phase 2." (`diagnosing-bugs/SKILL.md`)
- "The tickets are not a list of steps. They are a task graph with blocking relationships between them. This means there is always a frontier of tickets which are ready to be grabbed." (`implement-spec/SKILL.md`)
- "The review agent should be responsible for imposing coding standards, not the implementation agent." (`retro/SKILL.md`)
- "Every document and pointer you add spends one of two budgets: context load ... cognitive load." (`writing-for-agents/SKILL.md`)
- "Don't think of an elephant, and the elephant is all there is ... Prompt the positive." (`writing-for-agents/SKILL.md`)
- "a new skill it never mentions, or a stale one it still routes to, is a router that lies." (`CLAUDE.md`)

## Gaps / fetch notes

- Read from a shallow clone (depth 50) plus GitHub API for stars/forks/releases. Star count (~238k) is from the API on 2026-08-26; secondary sources cite lower numbers from earlier months.
- Did not read every reference file in full (`wayfinder` "Work through the map" tail, `teach/*`, `prototype/UI.md`, `wizard/template.sh`, `HTML-REPORT.md`, `AGENT-BRIEF.md`); descriptions come from SKILL.md bodies, bucket READMEs, `ask-matt`, and CHANGELOG.
- Video/X content not fetched directly; summarized from search snippets.
