# Methodologies and Prior Art for an Agentic Software Factory

Research compiled 2026-08-18 for a personal agentic software factory pipeline: PLANNER (grill-me-style interrogation across product/eng/UX perspectives -> design doc -> "Ready for Development") -> BUILDER (implements -> "In Review") -> REVIEWER (multi-lens review, fix loop -> "Done") -> DOCUMENTER/LIBRARIAN (learnings + context wiki).

This report has two parts: **Part A** is the raw research (five tracks, all URLs and verbatim quotes preserved); **Part B** is the synthesis — five concrete, adaptable deliverables (design-doc template, planner skill outline, reviewer lens list, builder definition-of-done checklist, librarian workflow).

---

## Table of contents — Part A (research)

1. Planning — AI Hero / Matt Pocock skills ("grill me" and the wider `mattpocock/skills` repo)
2. Planning — spec-driven development methodologies (Kiro/EARS, GitHub spec-kit, BMAD-METHOD, Shape Up, Amazon PR/FAQ, design-doc/RFC templates)
3. Building — autonomous builder agent patterns (Anthropic engineering blog, Claude Code docs)
4. Review — multi-lens and adversarial AI code review (Claude Code, CodeRabbit, Greptile, Graphite Diamond, Cursor Bugbot, Ellipsis, academic sources)
5. Documentation — librarian/memory patterns (AGENTS.md, CLAUDE.md, auto memory, ADRs, changelogs, lessons.md, context-engineering)

## Table of contents — Part B (deliverables)

6. Suggested design-doc template
7. Suggested PLANNER skill outline (three perspectives)
8. REVIEWER lens list with per-lens prompts
9. BUILDER definition-of-done checklist
10. LIBRARIAN workflow

---

# PART A — RESEARCH

# 1. Planning: AI Hero / Matt Pocock skills

# AI Hero / Matt Pocock skills — "grill me" and planning skill research

Source repo cloned to `/private/tmp/claude-501/-Users-roze-dev-factory/2fd6d52c-f3e9-48ac-a3e4-a32ce6b73df4/scratchpad/research/repos/skills` (github.com/mattpocock/skills, ~9K stars — Matt Pocock confirmed this on X: "My 'grill-me' skill went viral. mattpocock/skills is up to 9K stars... It's the most useful skill I've written, and I use it even outside of coding"). This is by far the richest single source for this report: it is a complete, working implementation of almost the entire pipeline the user is designing (grilling/planning, spec, tickets, TDD, implement, code-review, domain modeling/ADRs, triage state machine, handoff).

Also fetched (via WebFetch, page rendered to markdown by a summarizer, so treat as paraphrase except where quoted):
- https://www.aihero.dev/skills-grill-me
- https://www.aihero.dev/my-grill-me-skill-has-gone-viral
- https://www.aihero.dev/use-the-grill-me-skill-k029d (404 — page not found/renamed)

## 1. The `/grill-me` skill — exact mechanics

### What it does (aihero.dev summary, paraphrased from WebFetch)
> "takes a **loose idea** and interviews you until you can commit to it." It operates through rounds, where "each round is the whole **frontier** — every question whose prerequisites you have already settled."

Stateless: "The skill is **stateless**. It writes no files and leaves no workspace behind. The only thing it leaves is a sharper version of the idea, in your own head."

Completion: "when the frontier is empty — every branch visited, nothing left silently assumed." A typical session: "Forty-six questions across four rounds."

Success indicators quoted from the site: "You disagree with something. A session with no pushback from you is a session you didn't need" and "You end up somewhere you didn't expect, because a question surfaced a decision you had been making implicitly."

### VERBATIM source — `skills/productivity/grill-me/SKILL.md`
```yaml
---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

Call the Skill tool with "grilling".
```
`grill-me` is a thin **user-invoked** wrapper (only reachable by typing `/grill-me`, `disable-model-invocation: true`) that dispatches to the reusable **model-invoked** primitive `grilling`.

### VERBATIM source — `skills/productivity/grilling/SKILL.md` (the actual interview engine, full text)
```markdown
---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

​```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
​```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
```

### Key mechanics, distilled
- **Data structure**: a "design tree" — every decision branches into dependent decisions.
- **"Frontier"**: the set of not-yet-asked questions whose prerequisites (answers to earlier questions) are already known. Only the frontier is asked each round — never questions that would require guessing at an unmade decision.
- **Batch-and-wait loop**: ask the *whole* frontier in one numbered round with recommended answers, then stop and wait for the human. After each answer, recompute the frontier (newly-unblocked questions), and loop.
- **Question format**: `❓ **Q1** - **<title>**: <body>` then `➡️ <recommended answer>` — every question comes with the agent's own best-guess answer, so the user can just say "yes to all" or push back on specific ones.
- **Division of labor**: facts (anything discoverable by reading the codebase/filesystem/tools) are the agent's job — dispatch a sub-agent to look them up rather than asking the user; only genuine *decisions* go to the human.
- **Stopping condition**: frontier is empty (no more unresolved branches) AND the user explicitly confirms shared understanding. It is explicit: "Do not act on it until the user confirms."
- **Output**: nothing written to disk by `grilling`/`grill-me` itself — it's a pure conversation primitive. Composing skills (see below) are what persist results (to `CONTEXT.md`, ADRs, a spec doc, tickets, etc.).

### Where `grilling` is reused as a primitive
`grilling` is explicitly the shared engine behind five other skills: `grill-me`, `grill-with-docs`, `triage` (step "Grill (if needed)"), `wayfinder` (for "Grilling"-type tickets and for naming the destination/mapping the frontier), and `improve-codebase-architecture`. This "one interview primitive, many callers" pattern is itself a reusable design idea.

## 2. Other AI Hero / Matt Pocock skills relevant to planning

All from the same repo. Full file paths under `skills/`. The repo splits skills into **user-invoked** (only reachable by typing `/name`, orchestration) and **model-invoked** (reusable discipline, can be auto-invoked by the agent or called by another skill).

### `grill-with-docs` (user-invoked) — grilling + persisted domain model
```yaml
---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Call the Skill tool twice, for "grilling" and "domain-modeling".
```
Same interview engine as `grill-me`, but paired with `domain-modeling` (below) so that as decisions get made, terminology gets written into `CONTEXT.md` and hard-to-reverse decisions get written into ADRs, live, during the session. The README calls this "the single coolest technique in this repo."

### `domain-modeling` (model-invoked) — glossary + ADR discipline, full text
```markdown
---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editing an ADR.
---

Actively build and sharpen the project's domain model as you design... (see below for full behavior)
```
Behaviors: challenge the user's term against the existing glossary when it conflicts; sharpen vague/overloaded terms into a canonical name; stress-test domain relationships with concrete edge-case scenarios; cross-reference stated behavior against the actual code and surface contradictions; update `CONTEXT.md` **inline, immediately** (not batched) when a term is resolved. `CONTEXT.md` is declared to be "totally devoid of implementation details... a glossary and nothing else."

**File layout** (`skills/engineering/domain-modeling/CONTEXT-FORMAT.md`):
```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction
```
Rules: be opinionated (pick one canonical word, list synonyms to avoid), keep definitions to 1-2 sentences, only project-specific terms (not general programming concepts), group under subheadings if natural clusters emerge. Multi-context repos (monorepos) get a root `CONTEXT-MAP.md` listing each bounded context's `CONTEXT.md` location and the cross-context relationships (e.g., which events flow between them).

**ADR discipline** (`skills/engineering/domain-modeling/ADR-FORMAT.md`) — offer an ADR only when **all three** are true:
1. Hard to reverse — cost of changing your mind later is meaningful
2. Surprising without context — a future reader will wonder "why did they do it this way?"
3. Result of a real trade-off — genuine alternatives existed and one was picked for specific reasons

Minimal template: sequential numbering `docs/adr/0001-slug.md`; the whole body can legally be just a title + 1-3 sentences (context, decision, why). Optional sections (only when they add value): `Status` frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`), `Considered Options`, `Consequences`. "What qualifies": architectural shape, integration patterns between bounded contexts, technology choices that carry lock-in, boundary/scope decisions, deliberate deviations from the obvious path, non-visible constraints (compliance, SLAs), non-obvious rejected alternatives.

A real ADR example was found in the repo itself at `.agents/adr/0002-ship-as-a-claude-code-plugin.md` — worth noting it's a full living document, later appended with an "## Update, 2026-08-05" section rather than superseded, showing ADRs can be amended in place for status updates rather than only superseded.

### `to-spec` (user-invoked) — synthesis-only spec writer, no interview
```yaml
---
name: to-spec
description: Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.
disable-model-invocation: true
---
```
Deliberately the opposite of `grilling`: "Do NOT interview the user — just synthesize what you already know." Process: (1) explore repo, using existing domain glossary + respecting ADRs; (2) sketch the **test seams** the feature will be tested at, preferring existing seams, aiming for the fewest possible (ideally one), confirm with user; (3) write spec from template and publish with a `ready-for-agent` triage label.

**Spec template (verbatim):**
```markdown
## Problem Statement
The problem that the user is facing, from the user's perspective.

## Solution
The solution to the problem, from the user's perspective.

## User Stories
A LONG, numbered list of user stories. Format:
1. As an <actor>, I want a <feature>, so that <benefit>
This list should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions
A list of implementation decisions that were made: modules built/modified, interfaces, technical clarifications, architectural decisions, schema changes, API contracts, specific interactions.
Do NOT include specific file paths or code snippets — they go stale quickly.
Exception: if a prototype produced a snippet that encodes a decision more precisely than prose (state machine, reducer, schema, type shape), inline it and note it came from a prototype.

## Testing Decisions
What makes a good test (external behavior only, not implementation details); which modules will be tested; prior art for the tests in the codebase.

## Out of Scope
Things out of scope for this spec.

## Further Notes
Any further notes about the feature.
```
Note the explicit **"no file paths / line numbers, ever" rule** — repeated across `to-spec`, `to-tickets`, and the triage `AGENT-BRIEF.md` doc — because specs may sit for days/weeks before an agent picks them up and the codebase will have moved on. This is a durability principle worth adopting verbatim.

### `to-tickets` (user-invoked) — breaking a spec into a DAG of tracer-bullet tickets
Full text captured; key ideas:
- **Vertical slices, not horizontal**: "Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer." Each slice must be independently demoable/verifiable and sized to fit a single fresh agent context window.
- **Blocking edges**: each ticket declares which other tickets must complete first; a ticket with no blockers can start immediately. This is a DAG, not a flat backlog.
- **Wide-refactor exception**: mechanical, blast-radius-large changes (rename a column, retype a shared symbol) don't fit vertical slicing — sequence them as **expand → migrate (batched) → contract**, keeping CI green batch-to-batch.
- **Quiz the user** on the proposed breakdown (granularity right? blocking edges correct? merge/split?) before publishing.
- **Local ticket template:**
```markdown
# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```
- Same "no file paths / code snippets that will go stale" rule as `to-spec`, with the same prototype-snippet exception.

### `implement` (user-invoked) — the BUILDER, in three lines
```yaml
---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
```
This is essentially the entire BUILDER role definition the user is looking for, distilled to five sentences: implement from spec/tickets → TDD at pre-agreed seams → regular typecheck/single-test/full-suite gates → self-review via `/code-review` before commit → commit. (Full `/tdd` and `/code-review` skill text captured separately for the BUILDER/REVIEWER sections of this report — see notes below, and the master report will fold them in.)

### `triage` (user-invoked) — issue/PR state machine that composes grilling
Roles: two category roles (`bug`, `enhancement`) × five state roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Process per issue: gather context (read full issue/PR, check for redundant existing implementation, check `.out-of-scope/` for prior rejections) → recommend category/state to maintainer → **verify the claim** (reproduce the bug, or confirm the PR's diff does what it claims) before any grilling → grill if the request needs fleshing out (calls `grilling` + `domain-modeling`) → apply outcome (post an **agent brief**, or triage notes, or close with `.out-of-scope/` write-up). Every AI-authored comment must open with a disclaimer: `> *This was generated by AI during triage.*`

This "triage" state machine (`needs-triage → needs-info → ready-for-agent / ready-for-human → wontfix`) is directly reusable as the ticket lifecycle for the user's factory (their equivalent of "Ready for Development").

**AGENT-BRIEF.md** (durable spec-for-an-agent format, posted as a comment when an issue moves to `ready-for-agent`) — the clearest available "what a design doc consumed by an AI builder should contain" reference found in this research. Four principles:
1. **Durability over precision** — describe interfaces/types/behavioral contracts, never file paths or line numbers, never assume current implementation structure survives.
2. **Behavioral, not procedural** — describe *what*, not *how*. Good: `"The SkillConfig type should accept an optional schedule field of type CronExpression"`. Bad: `"Open src/types/skill.ts and add a schedule field on line 42"`.
3. **Complete acceptance criteria** — concrete, testable, independently verifiable. Good: `"Running gh issue list --label needs-triage returns issues that have been through initial classification"`. Bad: `"Triage should work correctly"`.
4. **Explicit scope boundaries** — state what's out of scope to prevent gold-plating.

Template:
```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description of what needs to happen

**Current behavior:**
Describe what happens now.

**Desired behavior:**
Describe what should happen after the agent's work is complete. Be specific about edge cases and error conditions.

**Key interfaces:**
- `TypeName` — what needs to change and why
- `functionName()` return type — what it currently returns vs what it should return
- Config shape — any new configuration options needed

**Acceptance criteria:**
- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2

**Out of scope:**
- Thing that should NOT be changed or addressed in this issue
```
A worked "bad" example is included in the source specifically to show the anti-pattern: vague summary, file-path/line-number references, no acceptance criteria, no scope boundary.

`.out-of-scope/` knowledge base (`OUT-OF-SCOPE.md`): one Markdown file per **rejected concept** (not per issue), written in a discursive design-doc style with a `## Why this is out of scope` section and a `## Prior requests` list of issue links. Only written for **rejected enhancements**, never for "already implemented" (that would poison future dedup checks with false rejections) and never for rejected bugs. Checked at the start of every triage pass for concept-level (not keyword) matches, and surfaced to the maintainer for confirm/reconsider/distinct.

### `wayfinder` (user-invoked) — planning work too big for one agent session
For efforts larger than a single spec: charts a **map** (a single tracked issue, label `wayfinder:map`) of **decision tickets** (child issues) connected by native blocking-dependency links, worked one **frontier** ticket at a time. Explicitly "**Plan, don't do**" — tickets resolve decisions, not deliverables (unless a Notes override says otherwise). Ticket types: `research` (AFK, subagent-driven fact-finding), `prototype` (HITL, cheap throwaway artifact to react to), `grilling` (HITL, the default — calls `grilling` + `domain-modeling`), `task` (HITL or AFK, unblocking chores like provisioning access). Introduces "fog of war" (`## Not yet specified` — questions sensed but not yet sharp enough to ticket) vs. "out of scope" (ruled outside the destination, never graduates). Rule: **never resolve more than one ticket per session**, except research tickets which can run in parallel as subagents. This is a genuinely novel pattern for very large planning efforts — arguably overkill for most individual tickets but a strong model for "epic"-scale planning that composes with `grilling`.

### `codebase-design` (model-invoked) — vocabulary for module/interface design, used during planning and review
Deep-module philosophy (via Ousterhout's *A Philosophy of Software Design* and Michael Feathers' "seam"): a module is **deep** when a small interface hides a lot of implementation; **shallow** when the interface is nearly as complex as what's behind it. Glossary insisted on exactly: Module, Interface (includes invariants/ordering/error modes, not just type signature), Implementation, Depth, Seam, Adapter, Leverage, Locality. Test: "**the deletion test**" — if deleting the module makes complexity vanish, it was a pass-through; if the complexity reappears across N callers, it was earning its keep. Also: "**One adapter means a hypothetical seam. Two adapters means a real one.**" This vocabulary is explicitly reused by `tdd` (to decide where a test seam goes) and `code-review` (Fowler smell baseline).

### `tdd` (model-invoked) — full text captured
```markdown
---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---
```
Core rules: tests verify behavior through **public interfaces**, never implementation details ("a good test reads like a specification"). **Seams** = the only place tests are allowed to attach; seams must be **pre-agreed with the user before any test is written** ("Test only at pre-agreed seams... Ask: 'What's the public interface, and which seams should we test?'"). Anti-patterns named explicitly: **implementation-coupled** (mocks internals, tests private methods, side-channel assertions — "the tell: the test breaks when you refactor but behavior hasn't changed"), **tautological** (assertion recomputes the expected value the same way the code does, so it can never disagree — "expected values must come from an independent source of truth"), **horizontal slicing** (writing all tests first then all implementation — "bulk tests verify *imagined* behavior"). Loop rules: **red before green** (write the failing test first, only enough code to pass, no anticipating future tests); **one slice at a time** (one seam, one test, one minimal implementation per cycle); **refactoring is explicitly not part of the TDD loop** — it belongs to the `code-review` stage instead.

### `code-review` (model-invoked) — the REVIEWER, full text captured (see section 4 of master report / file 06d for reuse). Key structural idea: **two independent axes run as parallel sub-agents so neither pollutes the other's context** — "Standards" (repo conventions + a fixed Fowler code-smell baseline) and "Spec" (does the diff match the originating issue). Findings are reported **side by side, never merged or re-ranked** — "Reporting them separately stops one axis from masking the other." This "orthogonal axes, parallel isolated sub-agents, no cross-contamination, no forced single ranking" pattern is a strong, directly reusable structure for the user's multi-lens REVIEWER.

### `diagnosing-bugs` (model-invoked) — phase-gated debugging discipline (relevant to BUILDER's ambiguity/verification behavior)
Phase 1 (the core of the skill): build a **tight, red-capable feedback loop** before hypothesizing anything — "If you catch yourself reading code to build a theory before this command exists, stop." Ordered list of loop-construction tactics (failing test → curl/HTTP script → CLI+fixture diff → headless browser script → replay captured trace → throwaway harness → property/fuzz loop → bisection harness → differential loop → HITL bash script as last resort). Explicit completion criteria checklist per phase (red-capable, deterministic, fast, agent-runnable). Phase 3 requires **3-5 ranked, falsifiable hypotheses shown to the user before testing any of them** ("Single-hypothesis generation anchors on the first plausible idea"), format: `"If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."` Explicit escalation rule: "When you genuinely cannot build a loop... Stop and say so explicitly... Do not proceed to hypothesise without a loop." This stop-and-ask-vs-proceed discipline is a good model for the BUILDER's ambiguity handling.

### `handoff` (user-invoked) — context handoff between agent sessions, full text
```yaml
---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.
```
Directly relevant to "context handoff notes" between BUILDER → REVIEWER → DOCUMENTER: don't restate what's already in a durable artifact, only reference it; redact secrets; name which skills the next session should invoke.

### `to-questionnaire` (user-invoked) — async variant of grilling for a third party
When the person who can answer isn't the user themselves, this turns the *decision the user can't answer alone* into a written questionnaire for the actual domain expert, sent async. Key insight: "**Grill the send, not the subject**" — interview the user only about *who it's going to* and *what they need back*; the questionnaire's actual questions target the gap between what the recipient knows and the user doesn't. Not directly needed for the single-user factory pipeline, but the "who/what-back" framing could be reused for a PLANNER step that needs to loop in a real stakeholder outside the AI loop.

### `writing-for-agents` (model-invoked) — the meta-skill for writing SKILL.md/AGENTS.md/CLAUDE.md themselves
Extremely relevant to how the user should author their own PLANNER/BUILDER/REVIEWER/DOCUMENTER skill prompts. Key concepts (verbatim/paraphrased):
- **Context pointer**: "a reference held in the agent's context that names some out-of-context material and encodes the condition for reaching it" (a skill's `description` field is one; a line in AGENTS.md naming a doc is another). "The pointer's *wording*, not its target, decides when the agent reaches the material."
- **Two loads**: *context load* (cost of always-loaded material on every turn) vs. *cognitive load* (cost on the human of remembering which doc to reach for and when) — "not a cost to minimise — it is the price of human agency."
- **Information hierarchy** (3 tiers): in-file step → in-file reference → disclosed reference (pushed to a separate file behind a pointer, i.e. progressive disclosure). "Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach."
- **Completion criteria** need both **clarity** (can the agent tell done from not-done?) and **demand** (how thorough must the work be — "every X accounted for" vs. "produce a list").
- **Leading words**: reuse existing pretrained concepts as compact anchors (e.g. "seam", "frontier", "tracer bullet") rather than coining new jargon or restating a concept in full sentences every time — "a made-up word recruits no priors; you pay in definition tokens what a pretrained word gives free."
- **Negation is a failure mode**: "steering by prohibition drags the forbidden behaviour into context and makes it more available, not less... Prompt the positive."
- **Pruning discipline**: single source of truth per meaning; treat the environment itself (config files, `--help`) as a source of truth and only "cache" what's expensive to look up (unwritten conventions, the *why*, gotchas); test every line for continued relevance; hunt "no-ops" — instructions the model would already do by default.

This document is itself a strong reference for **how to write the four role-prompts** (PLANNER/BUILDER/REVIEWER/DOCUMENTER) the user is designing — not just what to put in them.

### `improve-codebase-architecture` (user-invoked, mentioned in README but not fully read) — scans a codebase periodically (README recommends "once every few days") for module-deepening opportunities, presents them as an HTML report, then grills through whichever candidate is picked. Explicitly framed as "a survey, not a rescue" — won't untangle a genuinely messy codebase by itself.

### `setup-matt-pocock-skills` (user-invoked) — per-repo bootstrapping, run once
Configures: (1) issue tracker choice (GitHub/GitLab/local-markdown-under-`.scratch/`/other, detected from `git remote`), (2) triage label vocabulary (defaults to the five canonical role names verbatim), (3) domain-doc layout (single `CONTEXT.md`+`docs/adr/` vs. multi-context `CONTEXT-MAP.md`, auto-detected from monorepo signals). Writes a `## Agent skills` section into whichever of `CLAUDE.md`/`AGENTS.md` already exists (never creates a competing one), each pointing to `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`. This "index section in CLAUDE.md/AGENTS.md pointing to on-demand docs, not inlining them" pattern is directly relevant to the DOCUMENTER/LIBRARIAN's context-wiki design (section 4/5 of the master report).

## 3. Claude Code's own "plan mode"

(Lower priority than the above given time constraints — brief notes; the user already has first-hand familiarity with Claude Code, so this is mostly for citation completeness.)

- Anthropic ships Claude Code with a built-in **plan mode**, toggled with Shift+Tab, in which the agent is restricted to read-only exploration tools and must produce a written plan before any edits are made; the human reviews/edits the plan and then explicitly exits plan mode (via an `ExitPlanMode` tool call) to let the agent proceed to implementation. This is the same "converge on a plan before touching code" idea as `grilling`, but *un*-interactive by default — Claude proposes a full plan up front rather than an incremental Q&A; the loop-back to the human is "approve/edit the whole plan," not per-question. The AI Hero `grilling` primitive is a strictly more conversational, incremental alternative to this same problem.
- Anthropic's own engineering guidance (captured more fully by a parallel research track on builder patterns) emphasizes "think before you code" as a first-class practice for agentic coding, consistent with the plan-mode design.

## Notes on citation coverage / gaps

- The exact underlying LLM prompt Claude Code plan mode uses internally is not public; only the externally observable mechanics (Shift+Tab toggle, read-only tool restriction, ExitPlanMode) are documented by Anthropic. Detailed sourcing on this is likely covered by the parallel "builder patterns" research track; cross-check before finalizing the master report.
- Did not find a distinct "aihero.dev/skills" index page during this pass; the GitHub repo's README **Reference** section (quoted in full above) is a complete, better-organized substitute — it already classifies every skill as user-invoked vs. model-invoked and groups by Engineering vs. Productivity.

---

# 2. Planning: spec-driven development methodologies

# Spec-Driven Development Methodologies — Research Notes

Research for a PLANNER agent design (interrogates user → design doc → hands off to BUILDER).
Compiled 2026-08-18. Sources: live web fetches + `git clone --depth 1` of the actual
spec-kit and BMAD-METHOD repos into
`/private/tmp/claude-501/-Users-roze-dev-factory/2fd6d52c-f3e9-48ac-a3e4-a32ce6b73df4/scratchpad/research/repos/`.

---

## 1. Kiro (AWS agentic IDE) — spec-driven development + EARS

**Sources:**
- https://kiro.dev/docs/specs/ (three-file structure, phases)
- https://kiro.dev/blog/deep-spec-analysis/ ("Requirements analysis: catching requirement bugs before they become code", May 12 2026, Oyendrila Dobe et al.)
- https://kiro.dev/blog/faster-smarter-specs/ (May 12 2026, Ankit Sharma)
- https://alistairmavin.com/ears/ — the canonical EARS definition Kiro's own docs link to ("The EARS notation Kiro uses in requirement documents")

### Three-file spec structure

Kiro generates three foundational files per feature, stored as version-controlled artifacts in the repo:

1. **`requirements.md`** (or `bugfix.md` for the bugfix-spec variant) — user stories + acceptance criteria in EARS syntax, or for bugs: current/expected/unchanged behavior.
2. **`design.md`** — technical architecture, sequence diagrams, data flow, error handling, testing strategy.
3. **`tasks.md`** — discrete, trackable implementation tasks with real-time status; tasks can be run individually or concurrently, and Kiro added **parallel task execution** (analyzes dependencies, runs independent tasks concurrently — from "Specs just got faster (and smarter)").

Three-phase workflow: **Requirements → Design → Tasks**, described by Kiro's docs as turning "high-level ideas into detailed implementation plans with clear tracking and accountability." A newer "Quick plan mode" generates all three phases in one pass after asking clarifying questions up front, then presents them for review.

### EARS notation (canonical, from alistairmavin.com/ears/, source Kiro cites)

EARS = Easy Approach to Requirements Syntax, five patterns:

1. **Ubiquitous** (always active, no trigger): `The <system name> shall <system response>`
   Example: "The mobile phone shall have a mass of less than XX grams."
2. **State-driven** (`While`): `While <precondition(s)>, the <system name> shall <system response>`
   Example: "While there is no card in the ATM, the ATM shall display 'insert card to begin'."
3. **Event-driven** (`When`): `When <trigger>, the <system name> shall <system response>`
   Example: "When 'mute' is selected, the laptop shall suppress all audio output."
4. **Optional feature** (`Where`): `Where <feature is included>, the <system name> shall <system response>`
   Example: "Where the car has a sunroof, the car shall have a sunroof control panel on the driver door."
5. **Unwanted behaviour** (`If...Then`): `If <trigger>, then the <system name> shall <system response>`
   Example: "If an invalid credit card number is entered, then the website shall display 'please re-enter credit card details'."

**Complex requirements** combine keywords: `While <precondition(s)>, When <trigger>, the <system name> shall <system response>`.

### Real Kiro examples (verbatim, from kiro.dev/blog/deep-spec-analysis/)

Kiro enforces a semantic rule distinguishing nominal vs. error conditions:

> "In EARS, error conditions must use the IF-THEN pattern; WHEN patterns are for nominal conditions."

Quoted example requirements from that post:
- WHEN (nominal): "WHEN a Property Owner initiates property deletion..."
- IF-THEN (error): "IF the Property does not belong to the requesting Property Owner's User Account, THEN THE Platform SHALL reject..."
- WHILE (state): "WHILE an order is in a canceled-and-refunded state, THE Order System SHALL NOT..."
- A bugfix-spec pattern from kiro.dev/docs: `WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]` (used to encode regression-prevention requirements — i.e., "don't break this while fixing that").

Kiro's newer "Requirements analysis" feature applies what it calls "Neurosymbolic AI" to detect ambiguities and logical conflicts across EARS requirements automatically — i.e., a linting pass over the requirements file before design/tasks are generated.

### Takeaway for PLANNER design
EARS gives a **grammar for acceptance criteria** that is machine-checkable (five fixed sentence templates, keyword-triggered) — much stronger than free-text "the system should handle errors gracefully." A PLANNER could require every functional requirement in its design doc to compile to one of these five templates, and could programmatically flag any requirement that doesn't match one of the five patterns.

---

## 2. GitHub spec-kit — `/specify → /plan → /tasks` workflow

**Source:** actual clone of https://github.com/github/spec-kit (cloned to `repos/spec-kit`), specifically:
- `spec-driven.md` (root) — philosophy doc
- `templates/spec-template.md`, `templates/plan-template.md`, `templates/tasks-template.md`, `templates/constitution-template.md`
- `templates/commands/{specify,clarify,plan,tasks,analyze,checklist,constitution}.md` — the actual slash-command prompt text
- `.specify/memory/constitution.md` — a populated real-world example

### Core philosophy ("Power Inversion")

> "Spec-Driven Development (SDD) inverts this power structure. Specifications don't serve code—code serves specifications. The Product Requirements Document (PRD) isn't a guide for implementation; it's the source that generates implementation."

### The command pipeline (verbatim command list, in order)

`/speckit.constitution` → `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.checklist` → `/speckit.implement`

Each command file has YAML frontmatter with a `description` and `handoffs:` list naming the next agent/command and a suggested handoff prompt — an explicit graph of agent-to-agent handoffs baked into the tool.

#### `/speckit.specify` → `spec.md`
Creates a numbered feature branch (`001-`, `002-`, …) and populates `spec-template.md`. Template section headers (verbatim, from `templates/spec-template.md`):

```
# Feature Specification: [FEATURE NAME]
**Feature Branch** / **Created** / **Status** / **Input**
## User Scenarios & Testing (mandatory)
### User Story N - [Title] (Priority: P1/P2/P3)
  **Why this priority** / **Independent Test** / **Acceptance Scenarios** (Given/When/Then)
### Edge Cases
## Requirements (mandatory)
### Functional Requirements   (FR-001: System MUST ...)
### Key Entities (include if feature involves data)
## Success Criteria (mandatory)
### Measurable Outcomes        (SC-001: ...)
## Assumptions
```

Key discipline: every user story must be **independently testable/deployable/demonstrable** (an MVP slice on its own), and priorities (P1/P2/P3) are assigned so later phases can build an incremental delivery plan. Unclear requirements are marked inline: `[NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]` — the spec is explicitly forbidden from guessing.

Explicit instruction baked into the command: `✅ Focus on WHAT users need and WHY` / `❌ Avoid HOW to implement (no tech stack, APIs, code structure)`.

#### `/speckit.clarify` — up to 5 targeted questions
Runs **before** `/speckit.plan`. Scans the spec against a fixed ambiguity taxonomy (Functional Scope & Behavior, Domain & Data Model, Interaction & UX Flow, Non-Functional Quality Attributes, Integration & External Dependencies, Edge Cases & Failure Handling, Constraints & Tradeoffs, Terminology & Consistency, Completion Signals, Misc/Placeholders), marks each Clear/Partial/Missing, then asks **one question at a time**, max 5 total, each either multiple-choice (table of options, with a stated `**Recommended:** Option X — reasoning`) or short-answer (`**Suggested:** ... — reasoning`, ≤5 words). Answers are written back into a `## Clarifications` / `### Session YYYY-MM-DD` section and immediately propagated into the relevant spec section (Functional Requirements, Data Model, Success Criteria, Edge Cases, etc.) — never left orphaned in a Q&A log. This is a very concrete pattern for an interrogation phase with a hard question budget.

#### `/speckit.plan` → `plan.md` + `research.md` + `data-model.md` + `contracts/` + `quickstart.md`
`plan-template.md` section headers (verbatim):
```
# Implementation Plan: [FEATURE]
**Branch** / **Date** / **Spec**
## Summary
## Technical Context
  Language/Version, Primary Dependencies, Storage, Testing, Target Platform,
  Project Type, Performance Goals, Constraints, Scale/Scope
## Constitution Check      <- GATE: must pass before Phase 0 research; re-checked after Phase 1
## Project Structure
### Documentation (this feature)
### Source Code (repository root)
## Complexity Tracking     <- only if Constitution Check has violations that must be justified
  | Violation | Why Needed | Simpler Alternative Rejected Because |
```
Phase 0 (`research.md`): resolves every `NEEDS CLARIFICATION` via dispatched research tasks, recorded as `Decision / Rationale / Alternatives considered`. Phase 1: `data-model.md` (entities/fields/relationships/validation/state transitions), `contracts/` (API/interface contracts), `quickstart.md` (runnable validation scenarios — explicitly **not** allowed to contain full implementation code).

#### `/speckit.tasks` → `tasks.md`
Tasks are organized **by user story**, not by layer, so each priority slice (P1/P2/P3) is independently shippable. Strict checklist format: `- [ ] [TaskID] [P?] [Story?] Description with file path`, e.g. `- [ ] T012 [P] [US1] Create User model in src/models/user.py`. Phases: Setup → Foundational (blocking) → User Story 1 (🎯 MVP) → User Story 2 → … → Polish & Cross-Cutting. Includes an "Implementation Strategy" section with explicit MVP-first / incremental-delivery / parallel-team sub-strategies.

#### `/speckit.analyze` — read-only cross-artifact consistency check
Runs only after `tasks.md` exists. **Strictly read-only** — never modifies files, just emits a report. Builds a requirements inventory (FR-###/SC-### keys), a task-coverage map, and a constitution rule set, then runs detection passes: Duplication, Ambiguity (flags vague adjectives like "fast, scalable, secure, intuitive, robust" lacking measurable criteria), Underspecification, Constitution Alignment, Coverage Gaps, Inconsistency (terminology drift, conflicting requirements). Findings get a severity: CRITICAL (constitution MUST violation or zero-coverage core requirement) / HIGH / MEDIUM / LOW, output as a markdown table with stable IDs, capped at 50 rows. Ends by asking permission before proposing remediation edits — **never applies them automatically**.

#### `/speckit.checklist` — "Unit Tests for English"
Explicitly **not** a test/verification checklist. Verbatim: *"Checklists are UNIT TESTS FOR REQUIREMENTS WRITING - they validate the quality, clarity, and completeness of requirements."* Banned pattern: "Verify the button clicks correctly." Required pattern: "Is 'prominent display' quantified with specific sizing/positioning? [Clarity, Spec §FR-4]". Categories: Requirement Completeness, Clarity, Consistency, Acceptance Criteria Quality, Scenario Coverage, Edge Case Coverage, NFRs, Dependencies & Assumptions, Ambiguities & Conflicts. ≥80% of items must carry a traceability tag (`[Spec §X.Y]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`, `[Assumption]`). This is a directly reusable idea: a self-review checklist that audits the **spec's writing quality**, separate from implementation correctness.

#### `/speckit.constitution` → `memory/constitution.md`
A project's immutable principles doc, gating all later phases. Template uses numbered `[PRINCIPLE_N_NAME]` placeholders; the real populated example in the repo (`.specify/memory/constitution.md`) ratifies principles like "Test-Backed Change (NON-NEGOTIABLE)" and "Code Quality & Architectural Discipline," each with a **Rationale** paragraph, plus a `SYNC IMPACT REPORT` HTML comment at the top recording version bump, principles added/changed, and which templates were reviewed for consistency after the change. The generic `spec-driven.md` philosophy doc describes an example nine-article version with gates like:
```
#### Simplicity Gate (Article VII)
- [ ] Using ≤3 projects?
- [ ] No future-proofing?
#### Anti-Abstraction Gate (Article VIII)
- [ ] Using framework directly?
- [ ] Single model representation?
```
These gates are inlined into `plan-template.md`'s "Constitution Check" section and force the LLM to either pass the gate or document the violation in "Complexity Tracking" — i.e., a structured, auditable way of preventing scope/architecture creep.

### Multi-perspective review in spec-kit
Spec-kit does **not** have distinct product/eng/UX personas — it's a single-agent pipeline with strict phase gates and a dedicated read-only cross-check (`/speckit.analyze`) instead of multiple debating personas. The "review" is structural (gates, checklists, consistency analysis) rather than social/role-based.

### Decision criteria found
- Clarify **before** plan, always, unless user explicitly accepts increased rework risk for an "exploratory spike."
- `/speckit.analyze` only makes sense after tasks exist (needs all three artifacts to cross-check).
- Constitution violations are the only thing that blocks phase progression outright (CRITICAL); everything else is advisory.

---

## 3. BMAD-METHOD — persona agents + PRD → Architecture → Epics/Stories pipeline

**Source:** actual clone of https://github.com/bmad-code-org/BMAD-METHOD (cloned to `repos/BMAD-METHOD`), specifically `src/bmm-skills/agents/*/SKILL.md` + `customize.toml`, `src/bmm-skills/plan/bmad-prd/assets/prd-template.md`, `src/bmm-skills/plan/bmad-architecture/assets/spine-template.md`, `src/bmm-skills/plan/bmad-create-epics-and-stories/templates/epics-template.md`, `src/bmm-skills/plan/bmad-prfaq/*`, `src/core-skills/bmad-party-mode/*`.

### Named persona agents (each a distinct "character" with a name, role, identity, and value system)

| Persona | Role | Identity (verbatim from `customize.toml`) | Principles (verbatim) |
|---|---|---|---|
| **John** — Product Manager | "Translate product vision into a validated PRD, epics, and stories" | "Thinks like Marty Cagan and Teresa Torres. Writes with Bezos's six-pager discipline." | "PRDs emerge from user interviews, not template filling." / "Ship the smallest thing that validates the assumption." / "User value first; technical feasibility is a constraint." |
| **Winston** — System Architect | "Convert the PRD and UX into technical architecture decisions" | "Channels Martin Fowler's pragmatism and Werner Vogels's cloud-scale realism." | "Rule of Three before abstraction." / "Boring technology for stability." / "Developer productivity is architecture." |
| **Sally** — UX Designer | "Turn user needs and the PRD into UX design specifications that inform architecture and implementation" | "Grounded in Don Norman's human-centered design and Alan Cooper's persona discipline." | "Every decision serves a genuine user need." / "Start simple, evolve through feedback." / "Data-informed, but always creative." |
| **Mary** — Business Analyst | "Help the user ideate, research, and analyze before committing to a project" | "Channels Michael Porter's strategic rigor and Barbara Minto's Pyramid Principle discipline." | "Every finding grounded in verifiable evidence." / "Requirements stated with absolute precision." / "Every stakeholder voice represented." |
| **Amelia** — Senior Software Engineer (dev/BUILDER equivalent) | "Execute approved stories with test-first discipline — red, green, refactor" | (implementation-focused persona) | Test-first, file-path/AC-ID vocabulary |

Each agent's `SKILL.md` follows an identical activation ritual: resolve customization (base → team → user TOML merge) → adopt persona → load persistent facts → load project config → greet by name with an icon prefix → present a numbered menu (`Code | Description | Action`) → dispatch on user selection, **staying in character until dismissed**. Menus are data-driven (`[[agent.menu]]` entries in TOML), e.g. John's menu includes codes `PRD` (create/update/validate PRD), `CE` (create epics & stories), `IR` (check implementation readiness / opens sprint planning), `CC` (course-correct mid-implementation).

### Document flow: Brief/PR-FAQ → PRD → Architecture → Epics/Stories → Build

The BMAD delivery loop (from README) is: **Clarify → Plan → Build and verify → Learn and adjust** (loops back to Plan), sized to the work — "small changes go straight to build, complex work gets the depth it needs."

#### PRD template (`bmad-prd/assets/prd-template.md`) — section headers verbatim
```
## 0. Document Purpose
## 1. Vision
## 2. Target User
### 2.1 Jobs To Be Done
### 2.2 Non-Users (v1)
### 2.3 Key User Journeys        (UJ-1..UJ-N: Persona+context / Entry state / Path / Climax / Resolution / Edge case)
## 3. Glossary                   (canonical terms; FRs/UJs/SMs must reuse verbatim, no synonyms)
## 4. Features
### 4.1 {Feature Name}           -> Description, then nested:
  #### FR-1: {capability}         "[Actor] can [capability] [under conditions]. Realizes UJ-X."
     **Consequences (testable):** ...
     **Out of Scope:** ...
  **Feature-specific NFRs**
  **Notes**
## 5. Non-Goals (Explicit)
## 6. MVP Scope
### 6.1 In Scope   / ### 6.2 Out of Scope for MVP
## 7. Success Metrics
  **Primary** / **Secondary** / **Counter-metrics (do not optimize)**  -- each SM cross-references the FR(s) it validates
## 8. Open Questions
## 9. Assumptions Index
```
Notable disciplines: FRs, User Journeys (UJ), and Success Metrics (SM) are all **globally numbered and cross-referenced** to each other so downstream artifacts have stable IDs even after reorganizing; every inline `[ASSUMPTION: ...]` must be re-surfaced in §9; **Counter-metrics** ("what NOT to optimize") are explicitly called "as load-bearing as primary metrics" to stop gaming a target. An "Adapt-In Menu" appends optional section clusters by product type (Consumer/branded, Enterprise, Regulated, Developer/API products, Embedded/hardware) — the template scales itself rather than being one-size-fits-all, and includes a documented "Small-scope all-inclusive" mode for a 1-2 story hobby project (single-page PRD + inline stories).

#### Architecture template (`bmad-architecture/assets/spine-template.md`) — "Architecture Spine"
Frontmatter includes `altitude: feature` (`initiative` keeps features / `feature` keeps epics / `epic` keeps stories) — i.e., the architecture doc's granularity is explicitly parameterized by project size. Section headers verbatim:
```
## Design Paradigm
## Inherited Invariants        (only if this spine inherits a parent; read-only, never renumbered)
## Invariants & Rules          (AD-1, AD-2, ... each: Binds / Prevents / Rule; tag [ADOPTED] if pre-settled)
## Consistency Conventions     (table: Naming | Data & formats | State & cross-cutting)
## Stack                       (name+version only, "the why lives in the memlog")
## Structural Seed             (system/container diagram, ERD, minimal source tree — "scaffold, not a mirror to maintain")
## Capability → Architecture Map   (present only when a spec drove this run)
## Deferred                    (decisions intentionally pushed down, with the reason each can wait)
```
Explicit philosophy embedded in template comments: *"Decisions, not rationale... A small intent may be just paradigm + a few ADs + conventions; a platform earns more."* — i.e., architecture-doc weight is meant to scale down for small projects, same instinct as spec-kit's "mini design doc."

#### Epics/Stories template (`bmad-create-epics-and-stories/templates/epics-template.md`)
```
## Overview
## Requirements Inventory
### Functional Requirements / NonFunctional Requirements / Additional Requirements / UX Design Requirements
### FR Coverage Map
## Epic List
## Epic {{N}}: {{epic_title}}
### Story {{N}}.{{M}}: {{story_title}}
  As a {{user_type}}, I want {{capability}}, So that {{value_benefit}}.
  **Acceptance Criteria:**  Given/When/Then/And
```
This is a direct PRD → Epic → Story decomposition with a coverage map ensuring every FR maps to at least one story.

#### PR/FAQ workflow (`bmad-prfaq`) — Amazon Working-Backwards, implemented as a 5-stage pipeline
This is BMAD's own reusable clone of the Amazon PR/FAQ process (see §5 below), used as an **earlier, lighter-weight stage than the PRD** ("The PRFAQ replaces the product brief in your planning pipeline"). Five stages, each in its own reference file, each ending with "Route to `./next-stage.md`":

1. **Press Release** (`press-release.md`) — table of what each section forces:
   | Section | What It Forces |
   |---|---|
   | Headline | Can you say what this is in one sentence a customer would understand? |
   | Subheadline | Who benefits and what changes for them? |
   | Opening paragraph | What are you announcing, who is it for, and why should they care? |
   | Problem paragraph | Can you make the reader feel the customer's pain without mentioning your solution? |
   | Solution paragraph | What changes for the customer? (Not: what did you build.) |
   | Leader quote | What's the vision beyond the feature list? |
   | How It Works | Can you explain the experience from the customer's perspective? |
   | Customer quote | Would a real person say this? Does it sound human? |
   | Getting Started | Is the path to value clear and concrete? |

   Quality bars (verbatim): "No jargon", "No weasel words — 'significantly', 'revolutionary', 'best-in-class' are banned", "The mom test", "The 'so what?' test — every sentence should survive 'so what?'", "Honest framing."

2. **Customer FAQ** (`customer-faq.md`) — the agent role-plays "a busy, skeptical person who has been burned by promises before" and generates 6-10 hard questions across Skepticism / Trust / Practical concerns / Edge cases / "the hard question they're afraid of." Explicit ban: *"'How do I sign up?' is not a FAQ — it's a CTA."*

3. **Internal FAQ** (`internal-faq.md`) — role-plays "engineering lead, finance, legal, operations, the CEO" and asks Feasibility / Business viability / Resource reality / Risk / Strategic fit questions, e.g. "What kills this?", "What do we not know how to build yet?"

4. **The Verdict** (`verdict.md`) — final candid assessment sorted into three named buckets: **"Forged in steel"** (clear/compelling/defensible), **"Needs more heat"** (promising but underdeveloped), **"Cracks in the foundation"** (genuine unresolved risk). Produces a machine-readable summary (`verdict: "forged|needs-heat|cracked"`, `key_risks`, `open_questions`) plus a persistent **distillate** file (`prfaq-{project}-distillate.md`) that carries forward rejected framings, constraints, and open questions as dense context for the next planning stage — explicitly designed to survive context compaction.

#### `bmad-party-mode` — multi-persona debate/review (directly answers "does anyone have distinct personas debate a plan?")
Yes — explicitly. Party Mode stands up multiple installed BMAD agents (or custom personas) as a live round-table that argues with itself and the user. Key mechanics (verbatim):
- *"They clash, and you don't resolve it... Your instinct is to reconcile the voices and tie a bow — resist it. Clean consensus that took no effort is where the party dies."*
- *"Every voice is unmistakably itself... hide the labels and you'd still know who's speaking."*
- Four run modes: `session` (single model voices everyone), `auto` (spawns real subagents only when independent thinking changes the outcome), `subagent` (a real agent behind each persona for every substantive round), `agent-team` (Claude-Code-only: personas stood up as a **persistent team addressing each other directly**, not stitched together after the fact — "your job shifts from weaving to hosting").
- Session ends with a keepsake HTML transcript and an option to save any ad-hoc persona that emerged.

This is the closest concrete precedent found across all six sources for "multi-perspective (PM/architect/UX) debate over a plan" as an explicit, reusable mechanism rather than a one-off review meeting.

### Decision criteria found
- BMAD explicitly right-sizes process to change size: *"Small changes go straight to build. Complex work gets the depth it needs."* (README)
- PRD template's "Adapt-In Menu" is itself a decision procedure: add Enterprise/Regulated/Developer/Embedded clusters only if that domain applies; use the "Small-scope all-inclusive" single-doc mode when scope is 1-2 stories.
- PR/FAQ is explicitly the **pre-PRD** filter stage — used before committing to full PRD effort, mirroring Amazon's usage of PR/FAQ to kill most ideas before they reach a full plan.

---

## 4. Shape Up (Basecamp) — the pitch, and how it differs from a spec

**Sources:** https://basecamp.com/shapeup/1.2-chapter-03 (Set Boundaries / appetite), https://basecamp.com/shapeup/1.5-chapter-06 (Write the Pitch), https://basecamp.com/shapeup/2.2-chapter-08 (The Betting Table)

### The five pitch ingredients (verbatim definitions)

1. **Problem** — "The raw idea, a use case, or something we've seen that motivates us to work on this." A specific story showing why the current state fails, establishing a baseline for testing whether the solution actually solves the right issue.
2. **Appetite** — "How much time we want to spend and how that constrains the solution." Stated upfront (e.g. two weeks or six weeks); frames the deadline as a design constraint, not a target to blow past.
3. **Solution** — "The core elements we came up with, presented in a form that's easy for people to immediately understand." Presented via "fat marker sketches" / breadboards — deliberately low-fidelity.
4. **Rabbit Holes** — "Details about the solution worth calling out to avoid problems." Specific implementation traps flagged in advance so they don't derail the team mid-cycle.
5. **No-Gos** — "Anything specifically excluded from the concept: functionality or use cases we intentionally aren't covering."

### Appetite vs. estimate (the core inversion, verbatim)

> "Estimates start with a design and end with a number. Appetites start with a number and end with a design."

This is called "fixed time, variable scope." Two standard sizes: **Small Batch** (1-2 people, 1-2 weeks) and **Big Batch** (full team, six-week cycle). If a problem doesn't fit the appetite, the answer is to narrow the problem or break off a smaller meaningful part — never to silently extend the timebox.

### How a pitch differs from a traditional spec
- **Roughness is deliberate.** Fat-marker sketches, not wireframes or high-fidelity mockups — precise mockups "box in the designers" and invite unproductive debate about colors/pixels instead of the shape of the solution.
- **Designer/builder latitude is preserved.** The pitch communicates *why* and *what broadly*, not pixel-level *how*; teams are explicitly told they can "find a different design" than what's sketched.
- **Purpose is decision-making, not execution instructions.** A pitch exists to get a bet placed, not to be handed to an engineer as a literal build ticket.

### Multi-perspective review: "The Betting Table"
This is Shape Up's answer to multi-perspective plan review. Verbatim: attendees are senior decision-makers — the text describes "CEO (product authority), CTO, senior programmer, product strategist" — and *"The highest people in the company are there. There's no 'step two' to validate the plan or get approval."* Process: everyone studies pitches independently beforehand ("Ad-hoc one-on-one conversations in the weeks before usually establish some context too"), then the live meeting is short ("rarely go[ing] longer than an hour or two") and decision-focused, drawing on "knowledge of who's available, what the business priorities are, and what kind of work we've been doing lately." Output: a cycle plan (a concrete batch of pitches selected to build next). This is a **one-shot, high-authority group review** model — contrasts with BMAD's ongoing persona-debate model and spec-kit's single-agent gate model.

### Decision criteria for scale
Shape Up doesn't have an explicit "skip the pitch" rule the way design-doc guides do — every bet gets a pitch by construction, but the pitch's *size* self-limits: since appetite is fixed at 1-2 weeks (small batch) or 6 weeks (big batch), a pitch for a small batch is correspondingly terse.

---

## 5. Amazon PR/FAQ (Working Backwards)

**Sources:** https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes; corroborated/extended by BMAD's own `bmad-prfaq` implementation (§3 above), which closely mirrors the canonical Amazon structure.

### Core method
Teams "start by defining the customer experience, then iteratively work backwards from that point until the team achieves clarity of thought around what to build" — before writing any code or committing engineering resources.

### Document structure
- **Press Release (PR):** "a few paragraphs, always less than one page." Must pass the internal "so what?" test — is the product "meaningfully better (faster, easier, cheaper)" than existing alternatives, or is it not worth building.
- **FAQ:** "should be five pages or less," giving "all the salient details of the customer experience as well as a clear-eyed and thorough assessment of how expensive and challenging it will be for the company to build the product." (BMAD's implementation splits this into a **Customer FAQ** and an **Internal FAQ**, which maps cleanly onto Amazon's actual practice of separating customer-facing questions from internal feasibility/business questions.)

### Process (multi-perspective review, verbatim)
- Teams "write ten drafts of the PR/FAQ or more, and to meet with their senior leaders five times or more to iterate, debate, and refine the idea."
- Review meetings: distributed silent reading of the doc, then general feedback, then line-by-line detailed critique; **senior leaders speak last "to avoid influencing others"** — a specific anti-anchoring device worth stealing for any PLANNER review step.
- Deliberate filter: "The fact that most PR/FAQs don't get approved is a feature, not a bug" — most PR/FAQs never reach product launch.

### Decision criteria
Write a PR/FAQ **before** any design doc or PRD, specifically to kill weak ideas cheaply — it is explicitly a pre-commitment gate, not a build spec. BMAD's implementation formalizes this: the PR/FAQ workflow explicitly says "The PRFAQ replaces the product brief in your planning pipeline" and hands its "distillate" (rejected framings, open risks, resourcing signals) forward into PRD creation rather than being redundant with it.

---

## 6. Classic design-doc / RFC templates

### Google-style design doc (source: https://www.industrialempathy.com/posts/design-docs-at-google/, Malte Ubl)

Section structure:
1. **Context and Scope** — "Keep it succinct! The goal is that readers are brought up to speed."
2. **Goals and Non-Goals** — bulleted; non-goals are not simply negated goals but *reasonable possibilities deliberately excluded*.
3. **The Actual Design** — overview first, then: system-context diagrams, API sketches (not copy-pasted formal defs), data storage approach, pseudocode only for genuinely novel algorithms.
4. **Alternatives Considered** — documents rejected options and *"the trade-offs that each respective design makes and how those trade-offs led to the decision."*
5. **Cross-Cutting Concerns** — security, privacy, observability, and other org-wide standards.

**When to write one** — write a design doc if you answer "yes" to 3+ of:
- Is the right design uncertain and worthy of upfront investigation?
- Would involving senior engineers in design review add value?
- Is consensus needed around an ambiguous/contentious design?
- Does your team struggle to consider privacy/security/cross-cutting concerns?
- Do legacy systems need high-level documentation?

**Length:** 10-20 pages for larger projects; 1-3 pages ("mini design docs") for incremental changes.

**Review process:** two modes — *lightweight* (share via doc comments/messaging) or *formal* (dedicated design-review meeting with senior engineers, at the cost of slowing progress). Core value of review: incorporating "the combined experience of the organization... into a design," particularly catching cross-cutting concerns "when it is still relatively cheap to make changes."

### Rust RFC template (source: https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md)

Metadata: Feature Name, Start Date, RFC PR link, Rust Issue link. Section headers:
1. **Summary** — "One paragraph explanation of the feature."
2. **Motivation** — the problem, background, concrete use cases.
3. **Guide-level explanation** — teach the feature as if already shipped; examples; practical impact on how people think about/use the language.
4. **Reference-level explanation** — full technical design: interactions, implementation details, edge cases.
5. **Drawbacks** — reasons *not* to do this.
6. **Rationale and alternatives** — why this design over others; rejected alternatives; impact of *not* doing it.
7. **Prior art** — how other languages/communities solved this.
8. **Unresolved questions** — what's deferred to review vs. to implementation.
9. **Future possibilities** — natural extensions / long-term implications.

Notably splits explanation into two altitudes — "Guide-level" (teach it as a user) vs. "Reference-level" (full technical spec) — a pattern worth reusing: write the design doc so a user-facing walkthrough and an implementation-accurate reference coexist without duplicating each other's job.

### Common structure across both design-doc traditions
Both converge on: **Goals/Non-Goals (or Motivation) → Design/Proposal → Alternatives Considered/Rationale → Risks or Drawbacks or Cross-cutting concerns → Open/Unresolved questions.** This is the closest thing to a universal "engineering design doc skeleton," and it maps cleanly onto spec-kit's `plan.md` (Technical Context / Constitution Check / Project Structure / Complexity Tracking) and BMAD's architecture spine (Design Paradigm / Invariants & Rules / Deferred).

---

## Cross-cutting synthesis (for PLANNER design)

**Document staging that recurs across sources**, roughly in order of increasing formality/cost:
1. Amazon PR/FAQ or BMAD PR/FAQ — cheap, kills bad ideas before any design work (press release + customer FAQ + internal FAQ + verdict).
2. Shape Up pitch — rough, appetite-bounded, decision-oriented, not an execution spec.
3. spec-kit spec.md / BMAD PRD — the "what and why," EARS-style testable requirements, explicit non-goals, success metrics with counter-metrics.
4. Design doc (Google) / RFC (Rust) / spec-kit plan.md / BMAD architecture spine — the "how," with mandatory Alternatives Considered and Risks/Drawbacks sections, scaled in length to project stakes.
5. Task/story breakdown (spec-kit tasks.md, BMAD epics-template.md) — the handoff artifact to a BUILDER, organized by independently-shippable slices with explicit dependency ordering.

**Multi-perspective review mechanisms found, ranked by concreteness for reuse:**
- **BMAD party-mode** — named personas with distinct identities/principles genuinely arguing, unresolved by design, four selectable "how real" modes (inline voice → persistent agent team). Most directly reusable for a PLANNER wanting simulated PM/architect/UX debate.
- **Amazon PR/FAQ review ritual** — silent read → open feedback → line-by-line critique → most senior person speaks last (anti-anchoring). Reusable as a review *procedure* even with a single reviewer.
- **Shape Up betting table** — a small, fixed, high-authority group makes a fast, bounded-time decision; optimized for speed and authority, not exhaustive debate.
- **spec-kit's `/analyze`** — no personas at all; a structural, single-pass, read-only consistency auditor instead of social debate. Good complement to persona debate, not a replacement.
- **Google design-doc review** — lightweight (async comments) vs. formal (senior review meeting), gated by an explicit 5-question "do you need this" checklist — the only source with a crisp yes/no decision procedure for whether review is warranted at all.

**Requirement-quality mechanisms worth stealing directly:**
- Kiro/EARS: every functional requirement forced into one of 5 fixed sentence templates (Ubiquitous/State/Event/Optional/Unwanted-behavior), enabling automated ambiguity/conflict detection.
- spec-kit's `[NEEDS CLARIFICATION: ...]` inline marker — never guess, always flag.
- spec-kit's checklist command — "unit tests for English," auditing the requirements' clarity/completeness/consistency, not implementation.
- BMAD PRD's cross-referencing IDs (FR-#, UJ-#, SM-#) and "Counter-metrics (do not optimize)" — prevents both silent scope drift and metric-gaming.

---

# 3. Building: autonomous builder agent patterns

# Research: BUILDER agent patterns for an agentic software factory

Scope: patterns for an autonomous/semi-autonomous coding agent that implements a PLANNER's
design doc, moves a ticket to "In Review", and hands off to a REVIEWER → DOCUMENTER pipeline.
Compiled 2026-08-18. Sources are primarily Anthropic's own engineering blog
(anthropic.com/engineering) and Claude Code docs (code.claude.com/docs — the current home
of what used to live at docs.claude.com/claude-code), since general web search was
unavailable for most of this session (WebSearch tool returned "session has used its web
search budget (200 of 200)" on every call). Where noted, some independent/community sources
could not be reached (DuckDuckGo, Bing, Mojeek, Google, and web.archive.org all blocked the
fetcher with CAPTCHAs, 403s, or explicit refusals). All Anthropic primary sources below load
fine via WebFetch and are quoted verbatim.

---

## 0. Foundational posts (as specifically requested)

### 0.1 "Building effective agents" — anthropic.com/engineering/building-effective-agents (Dec 19, 2024)
URL: https://www.anthropic.com/engineering/building-effective-agents

**Workflows vs. agents (the core distinction):**
> "Workflows are systems where LLMs and tools are orchestrated through predefined code paths."
> "Agents … are systems where LLMs dynamically direct their own processes and tool usage,
> maintaining control over how they accomplish tasks."

**Three core principles for agent design:**
1. Simplicity — "Maintain simplicity in your agent's design."
2. Transparency — "Prioritize transparency by explicitly showing the agent's planning steps."
3. Agent-Computer Interface (ACI) — "Carefully craft your agent-computer interface (ACI)
   through thorough tool documentation and testing."

**When to use an agent vs. a simpler workflow:**
> "Finding the simplest solution possible, and only increasing complexity when needed."
> "Use agents for open-ended problems where it's difficult or impossible to predict the
> required number of steps, and where you can't hardcode a fixed path."
For most applications, "optimizing single LLM calls with retrieval and in-context examples
is usually enough."

**Environmental feedback — directly relevant to BUILDER's verification loop:**
> "During execution, it's crucial for the agents to gain 'ground truth' from the environment
> at each step (such as tool call results or code execution) to assess its progress."
This is the design rationale for a BUILDER that runs tests/build/lint after every change
rather than just asserting "done."

**Human oversight checkpoints — directly relevant to the ambiguity/escalation question:**
> Agents should "pause for human feedback at checkpoints or when encountering blockers."
Given "higher costs, and the potential for compounding errors," the post recommends
"appropriate guardrails" and "extensive testing in sandboxed environments."

**Stopping conditions:**
> Implementation should include "stopping conditions (such as a maximum number of
> iterations) to maintain control." — a direct precedent for a BUILDER's max-iteration or
> max-turn cap before it must hand off / escalate instead of looping forever.

**Investment in tool design over prompt tuning (relevant to ACI/tool ergonomics for a
factory's internal tools, e.g. ticket-status APIs):**
> "We actually spent more time optimizing our tools than the overall prompt," including
> using absolute file paths and clear parameter requirements to reduce model errors.

Building-block taxonomy (useful vocabulary for describing the PLANNER→BUILDER→REVIEWER→
DOCUMENTER pipeline itself, which is essentially a **prompt-chaining workflow** with an
**evaluator-optimizer** loop nested inside the BUILDER step):
- **Prompt chaining**: "Decomposes a task into a sequence of steps, where each LLM call
  processes the output of the previous one" — this is exactly the ticket pipeline's shape.
- **Evaluator-optimizer**: "One LLM call generates a response while another provides
  evaluation and feedback in a loop" — this is exactly the REVIEWER's role relative to
  BUILDER, and also describes a BUILDER's internal test-run loop.
- **Orchestrator-workers**: "A central LLM dynamically breaks down tasks, delegates them to
  worker LLMs, and synthesizes their results" — relevant if BUILDER itself fans out
  sub-tasks to subagents.

### 0.2 "Claude Code: Best practices for agentic coding" — originally anthropic.com/engineering/claude-code-best-practices (Apr 18, 2025); now permanently redirects to and is maintained at https://code.claude.com/docs/en/best-practices
URL (current, canonical): https://code.claude.com/docs/en/best-practices
URL (original blog listing, now a 308 redirect to the above): https://www.anthropic.com/engineering/claude-code-best-practices

Note: the original April 2025 blog post has been folded into the living docs page above, so
what follows is quoted from the current (Aug 2026) version, which Anthropic keeps updated.
It is the single most load-bearing source for this research task.

**The core verification-loop principle (== TDD / "definition of done" for an agent):**
> "Give Claude a check it can run: tests, a build, a screenshot to compare. It's the
> difference between a session you watch and one you walk away from."
>
> "Claude stops when the work looks done. Without a check it can run, 'looks done' is the
> only signal available, and you become the verification loop: every mistake waits for you
> to notice it. Give Claude something that produces a pass or fail, and the loop closes on
> its own. Claude does the work, runs the check, reads the result, and iterates until the
> check passes."

Concrete before/after prompt patterns given in the doc (table, verbatim):
| Strategy | Before | After |
|---|---|---|
| Provide verification criteria | *"implement a function that validates email addresses"* | *"write a validateEmail function. example test cases: user@example.com is true, invalid is false, user@.com is false. run the tests after implementing"* |
| Verify UI changes visually | *"make the dashboard look better"* | *"[paste screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them"* |
| Address root causes, not symptoms | *"the build is failing"* | *"the build fails with this error: [paste error]. fix it and verify the build succeeds. address the root cause, don't suppress the error"* |

**Escalating gate strength — a directly reusable ladder for a factory's BUILDER→"In Review" gate:**
> "Once the check exists, decide how hard it gates the stop:
> - **In one prompt**: ask Claude to run the check and iterate in the same message …
> - **Across a session**: set the check as a `/goal` condition. A separate evaluator
>   re-checks it after every turn and Claude keeps working until the goal resolves. If
>   Claude stalls, Claude Code eventually stops the run with the goal still set …
> - **As a deterministic gate**: a Stop hook runs your check as a script and blocks the turn
>   from ending until it passes. Claude Code overrides the hook and ends the turn after
>   8 consecutive blocks.
> - **By a second opinion**: a verification subagent or a dynamic workflow that checks its
>   own findings has a fresh model try to refute the result, so the agent doing the work
>   isn't the one grading it."
>
> "Each step trades setup for attention. The prompt version works on any task today. The
> `/goal` and Stop hook versions are what let an unattended run finish correctly without you."

**Evidence over assertion (relevant to handoff notes / "show your work" for REVIEWER):**
> "Have Claude show evidence rather than asserting success: the test output, the command it
> ran and what it returned, or a screenshot of the result. Reviewing evidence is faster than
> re-running the verification yourself, and it works for sessions you weren't watching."

**The four-phase workflow — explore, plan, code, commit (maps directly onto
PLANNER→BUILDER but also describes what BUILDER itself should do before touching code):**
> Steps: **Explore** (plan mode, read-only) → **Plan** (ask for a detailed implementation
> plan; "Press Ctrl+G to open the plan in your text editor for direct editing before Claude
> proceeds") → **Implement** ("let Claude code, verifying against its plan" — sample prompt:
> *"implement the OAuth flow from your plan. write tests for the callback handler, run the
> test suite and fix any failures."*) → **Commit** (*"commit with a descriptive message and
> open a PR"*).
>
> Callout on when to skip planning: "Planning is most useful when you're uncertain about the
> approach, when the change modifies multiple files, or when you're unfamiliar with the code
> being modified. If you could describe the diff in one sentence, skip the plan."

**Self-review before handoff — an explicit named pattern, "Add an adversarial review step":**
> "The longer Claude works unattended, the more an independent check matters before you
> count the work as done. A reviewer running in a fresh subagent context sees only the diff
> and the criteria you give it, not the reasoning that produced the change, so it evaluates
> the result on its own terms."
>
> Sample prompt template for a BUILDER to self-review against a spec before flagging done:
> *"Use a subagent to review the rate limiter diff against PLAN.md. Check that every
> requirement is implemented, the listed edge cases have tests, and nothing outside the
> task's scope changed. Report gaps, not style preferences."*
>
> "Because the reviewer runs as a subagent, the implementing session receives the gaps
> directly and can fix them and re-review without you copying findings between windows."
>
> Guardrail against over-fixing false positives from adversarial review:
> "A reviewer prompted to find gaps will usually report some, even when the work is sound,
> because that is what it was asked to do. Chasing every finding leads to over-engineering:
> extra abstraction layers, defensive code, and tests for cases that can't happen. Tell the
> reviewer to flag only gaps that affect correctness or the stated requirements, and treat
> the rest as optional."

There is also a bundled `/code-review` skill: "run the bundled `/code-review` skill, which
reviews the current diff for bugs in a fresh subagent and returns findings to the session."

**Writer/Reviewer session pattern (maps almost exactly onto BUILDER/REVIEWER as separate
agents with separate context):**
> | Session A (Writer) | Session B (Reviewer) |
> | `Implement a rate limiter for our API endpoints` | |
> | | `Review the rate limiter implementation in @src/middleware/rateLimiter.ts. Look for edge cases, race conditions, and consistency with our existing middleware patterns.` |
> | `Here's the review feedback: [Session B output]. Address these issues.` | |
>
> "Beyond parallelizing work, multiple sessions enable quality-focused workflows. A fresh
> context improves code review since Claude won't be biased toward code it just wrote."
> "You can do something similar with tests: have one Claude write tests, then another write
> code to pass them." — an explicit TDD-by-two-agents pattern.

**Ambiguity handling / when to interview a human before building (spec-writing pattern
directly applicable to a PLANNER's design doc, or to a BUILDER hitting an underspecified
ticket):**
> "For larger features, have Claude interview you first. Start with a minimal prompt and ask
> Claude to interview you using the AskUserQuestion tool."
> Prompt template: *"I want to build [brief description]. Interview me in detail using the
> AskUserQuestion tool. Ask about technical implementation, UI/UX, edge cases, concerns, and
> tradeoffs. Don't ask obvious questions, dig into the hard parts I might not have
> considered. Keep interviewing until we've covered everything, then write a complete spec
> to SPEC.md."*
> "Once the spec is complete, start a fresh session to execute it. The new session has clean
> context focused entirely on implementation, and you have a written spec to reference."
> "The most useful specs are self-contained: they name the files and interfaces involved,
> state what is out of scope, and end with an end-to-end verification step that proves the
> feature works."

**Failure patterns explicitly named — a ready-made checklist of BUILDER anti-patterns:**
> - "**The kitchen sink session.**" — mixing unrelated tasks in one context. Fix: `/clear`.
> - "**Correcting over and over.**" — after two failed corrections on the same issue, `/clear`
>   and write a better prompt "incorporating what you learned."
> - "**The over-specified CLAUDE.md.**" — bloated rules get ignored; "Ruthlessly prune."
> - "**The trust-then-verify gap.**" — "Claude produces a plausible-looking implementation
>   that doesn't handle edge cases. Fix: Always provide verification (tests, scripts,
>   screenshots). **If you can't verify it, don't ship it.**"
> - "**The infinite exploration.**" — unscoped "investigate" tasks fill context. Fix: scope
>   narrowly or delegate to subagents.

**Autonomous/scaled execution (non-interactive `-p` mode, `--allowedTools` scoping, fan-out):**
> `claude -p "prompt"` "is how you integrate Claude into CI pipelines, pre-commit hooks, or
> any automated workflow." For batch/fan-out work: `--allowedTools` "restricts what Claude
> can do, which matters when you're running unattended."
> Auto mode: "A classifier model reviews commands before they run, blocking scope
> escalation, unknown infrastructure, and hostile-content-driven actions while letting
> routine work proceed without prompts."

---

## 1. TDD loops with coding agents

Primary guidance is the "Give Claude a way to verify its work" section of the best-practices
doc (quoted fully in §0.2 above) — the check-driven loop ("Claude does the work, runs the
check, reads the result, and iterates until the check passes") is Anthropic's canonical
description of a TDD-style agent loop, generalized beyond just unit tests to any pass/fail
signal (build exit code, linter, fixture diff, screenshot comparison).

The **Common workflows** doc (https://code.claude.com/docs/en/common-workflows) gives the
concrete "Work with tests" recipe:
> Steps: "find functions … not covered by tests" → "add tests for the notification service"
> → "add test cases for edge conditions" → "run the new tests and fix any failures."
> "Claude can generate tests that follow your project's existing patterns and conventions
> … Claude examines your existing test files to match the style, frameworks, and assertion
> patterns already in use."
Same doc's bug-fix recipe encodes "reproduce first, then fix" — a TDD variant for bugs:
> *"users report that login fails after session timeout. check the auth flow in src/auth/,
> especially token refresh. write a failing test that reproduces the issue, then fix it"*
> (this exact phrasing — "write a failing test that reproduces the issue, then fix it" —
> appears verbatim in the best-practices doc's "Describe the symptom" row too).

The writer/reviewer pattern above also generalizes to test-first: "have one Claude write
tests, then another write code to pass them" — i.e., a two-agent red/green split where one
agent's role is strictly to write the failing tests from spec before a second agent (which
could be your BUILDER) ever sees the implementation task.

**Design implication for a factory BUILDER:** the loop that should run inside a BUILDER
before it moves a ticket to "In Review" is: (1) derive or confirm test cases from the design
doc's acceptance criteria, (2) run them to confirm they fail for the right reason (missing
feature, not broken harness), (3) implement, (4) run the full check suite (tests + build +
lint + typecheck), (5) iterate until green, (6) attach the evidence (command + output) to the
ticket rather than just asserting "done."

---

## 2. Small PRs / incremental commits

No single Anthropic doc is dedicated to diff size, but the guidance is consistent across
sources:

- Best-practices doc's four-phase workflow ends each unit of work with **Commit**: *"commit
  with a descriptive message and open a PR"* — implying commit-per-completed-increment, not
  one giant commit at the end.
- "Do refactoring in small, testable increments" — tip under the Refactor Code recipe in
  Common Workflows.
- The fan-out pattern for large migrations explicitly scripts one Claude invocation *per
  file*, each producing its own scoped change with `--allowedTools "Edit,Bash(git commit *)"`
  — i.e., programmatically enforced small-diff-per-commit at scale:
  ```bash
  for file in $(cat files.txt); do
    claude -p "Migrate $file from React to Vue. Return OK or FAIL." \
      --allowedTools "Edit,Bash(git commit *)"
  done
  ```
- CLAUDE.md guidance table explicitly recommends encoding **"Repository etiquette (branch
  naming, PR conventions)"** as one of the things worth putting in a project's CLAUDE.md —
  i.e., a factory should put its PR/commit conventions in CLAUDE.md so every agent inherits
  them automatically rather than being told per-session.
- PR review is explicitly framed as a human-verification step even when Claude authors the
  PR: "Review Claude's generated PR before submitting and ask Claude to highlight potential
  risks or considerations" (Common Workflows, Create pull requests section).

**Commit message convention ("Co-Authored-By"):** Anthropic doesn't appear to document a
formal spec for this in the public docs pages fetched, but it is the de facto standard
convention shipped in Claude Code's own default git-commit behavior — Claude Code's built-in
commit workflow appends a trailer identifying the AI as co-author (of the form
`Co-Authored-By: Claude <noreply@anthropic.com>`, plus a session-link trailer), so that
`git log`/`git blame` and GitHub's UI make agent-authored commits visually distinguishable
from human-authored ones without breaking normal git tooling. This is the same convention
this research session's own commit instructions use. Recommend the factory adopt an
analogous trailer per agent role (e.g. `Co-Authored-By: Builder-Agent <...>`) so REVIEWER/
DOCUMENTER and audit tooling can tell which pipeline stage authored which commit.

**GitHub Actions integration** (https://code.claude.com/docs/en/github-actions) reinforces
commit/PR hygiene at the CI level: a documented gotcha is that
> "GitHub doesn't trigger workflows on commits made with the default `GITHUB_TOKEN`. If you
> pass `github_token: ${{ secrets.GITHUB_TOKEN }}` to the Claude Code GitHub Action, remove
> it so it authenticates as the Claude GitHub App, or pass a custom app token instead"
— relevant if a factory's BUILDER pushes commits that must still trigger the REVIEWER's CI
gate.

---

## 3. Verification gates / "definition of done" checks

This is the best-documented area. Two mechanisms:

### 3.1 The gate ladder (from best-practices doc, quoted fully in §0.2)
Prompt-level check → `/goal` condition (a separate evaluator re-checks after every turn) →
**Stop hook** (deterministic script gate) → adversarial subagent review. The Stop-hook tier
is the closest analog to a hard CI gate: *"a Stop hook runs your check as a script and
blocks the turn from ending until it passes. Claude Code overrides the hook and ends the
turn after 8 consecutive blocks."* — note the built-in circuit breaker (8 consecutive
blocks) so a mis-specified gate can't infinite-loop the agent forever.

### 3.2 Claude Code hooks reference — https://code.claude.com/docs/en/hooks (redirect target of docs.claude.com/en/docs/claude-code/hooks)
Hook events relevant to a BUILDER's gating:
- **`PreToolUse`** — fires before a tool call; can return `permissionDecision: "deny"` to
  block it (used for guardrails, e.g. blocking `rm -rf` or edits outside scope).
- **`PostToolUse`** — fires after a tool succeeds; cannot block retroactively but can surface
  stderr/output back to Claude (used for "run lint after every Edit/Write").
- **`PostToolUseFailure`** — fires after a tool call fails; can provide failure analysis.
- **`PostToolBatch`** — fires after a full batch of parallel tool calls resolves, before the
  next model call; **can block the agentic loop before the next model call**.
- **`Stop`** — fires when Claude finishes responding; **can block to prevent stopping** —
  this is the hook a factory would use to enforce "tests must pass before this ticket can be
  marked ready for review."
- **`SessionStart` / `SessionEnd`** — lifecycle hooks.
- **`TeammateIdle` / `TaskCreated` / `TaskCompleted`** (agent-teams specific, see §8) — "Exit
  with code 2 to send feedback and keep the teammate working" / "prevent creation" /
  "prevent completion."

Exit-code semantics that determine blocking behavior:
> "Exit 0 means success, and is the intended exit code when you print JSON for structured
> control … Exit 2: Blocking error. Blocks the action regardless of JSON output."

Example `PostToolUse` config for auto-linting after every edit:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-style.sh" }
        ]
      }
    ]
  }
}
```

From the best-practices doc's "Set up hooks" section:
> "Hooks run scripts automatically at specific points in Claude's workflow. Unlike CLAUDE.md
> instructions which are advisory, **hooks are deterministic and guarantee the action
> happens**." (This is the single clearest articulation of why a factory should use hooks,
> not just prompted instructions, to enforce a BUILDER's definition-of-done.)
> "Claude can write hooks for you. Try prompts like 'Write a hook that runs eslint after
> every file edit' or 'Write a hook that blocks writes to the migrations folder.'"

### 3.3 Guardrails / containment ("How we contain Claude" — anthropic.com/engineering/how-we-contain-claude)
Not verification-gate specific but directly relevant to "what must be true before an
autonomous BUILDER is trusted to run unattended":
> "Rather than supervising what the agent does, we supervise what it's *able* to do by
> enforcing access boundaries through, for example, sandboxes, virtual machines, and egress
> controls." (environment-layer defense, described as primary/strongest layer)
> "Design for containment at the environment layer first, then steer behavior at the model
> layer." — model-layer defenses (system prompts, classifiers) "shape only what the agent
> *tends* to do, not what it is theoretically capable of doing."
> On approval fatigue as a failure mode of human-gated workflows: "our telemetry showed
> users approved roughly 93% of permission prompts" — motivating a shift to OS-level
> sandboxing, which "reduced permission prompts by 84%."
> "The question of whether a user can evaluate what an agent is about to do should help
> determine the containment strategy."

**Design implication:** a factory's BUILDER definition-of-done should combine (a) a Stop
hook or CI-gated check that deterministically blocks handoff until build+lint+test+typecheck
pass, with (b) environment-level containment (sandboxing / worktree isolation, §5) so that a
BUILDER *cannot* touch things outside its ticket's scope even before the check runs, rather
than relying solely on the agent choosing to behave.

---

## 4. Self-review before handoff

Covered in depth in §0.2 ("Add an adversarial review step"). Key mechanics worth restating
for the factory's REVIEWER-handoff design:

- Self-review should happen in a **fresh subagent context** that sees only the diff + the
  acceptance criteria, not the implementer's reasoning trail — this avoids the reviewer
  inheriting the implementer's blind spots/rationalizations. Quote: "A reviewer running in a
  fresh subagent context sees only the diff and the criteria you give it, not the reasoning
  that produced the change, so it evaluates the result on its own terms."
- The review should be scoped against a **named artifact** (a plan/spec doc), not vibes:
  "Use a subagent to review the … diff against PLAN.md. Check that every requirement is
  implemented, the listed edge cases have tests, and nothing outside the task's scope
  changed. Report gaps, not style preferences."
- Findings should be triaged, not blindly fixed: "Tell the reviewer to flag only gaps that
  affect correctness or the stated requirements, and treat the rest as optional" — otherwise
  over-fixing produces "extra abstraction layers, defensive code, and tests for cases that
  can't happen."
- Anthropic ships this as a reusable primitive: the bundled **`/code-review` skill** "reviews
  the current diff for bugs in a fresh subagent and returns findings to the session," so the
  implementing session can "fix them and re-review without you copying findings between
  windows."
- For longer unattended runs, this loop can be chained: "For longer autonomous runs, an
  agent team can keep this loop going across many tasks while you spot-check the recorded
  findings" — i.e., self-review-then-fix can iterate multiple rounds before the human (or
  the factory's REVIEWER stage) ever sees the ticket.

**Design implication:** a BUILDER's last step before moving a ticket to "In Review" should
be to spawn a fresh-context self-review pass against the design doc (not just re-reading its
own transcript), fix only correctness/requirement gaps it finds, and attach the review
findings + resolution notes to the ticket as part of the handoff.

---

## 5. Worktree isolation

Primary source: https://code.claude.com/docs/en/worktrees ("Run parallel sessions with
worktrees"), summarized/linked from https://code.claude.com/docs/en/common-workflows and
https://code.claude.com/docs/en/best-practices.

**Core definition and rationale:**
> "A git worktree is a separate working directory with its own files and branch, sharing the
> same repository history and remote as your main checkout. Running each Claude Code session
> in its own worktree means edits in one session never touch files in another, so one
> session can build a feature while a second fixes a bug."

**Basic usage:**
```bash
claude --worktree feature-auth
```
> "By default, the worktree is created under `.claude/worktrees/<name>/` at your repository
> root, on a new branch named `worktree-<name>`." Running the same command with a different
> name in another terminal starts a second isolated session. "Add `.claude/worktrees/` to
> your `.gitignore` so worktree contents don't appear as untracked files in your main
> checkout."

**Claude can self-serve worktrees mid-session** via the `EnterWorktree` tool ("work in a
worktree"), and switch between them; entering a path *outside* `.claude/worktrees/` requires
explicit user approval because it relocates the session's write access and config (CLAUDE.md,
settings).

**Cleanup semantics** — relevant for a factory that spins up many short-lived BUILDER runs:
> "The worktree is clean: for an unnamed session, Claude removes the worktree and its branch
> automatically. A named session prompts you first … The worktree has work in it: Claude
> prompts you to keep or remove the worktree." Non-interactive (`-p`) runs get no exit
> prompt and leave a lock in place until a periodic stale-lock sweep clears it.

**Four enforced isolation checks** while a session is in a worktree (this is the actual
technical guarantee, not just convention):
> "Claude Code applies four checks: **File edits** — blocks Edit/Write/NotebookEdit targeting
> the main checkout. **Command working directory** — blocks a Bash/PowerShell/Monitor command
> whose cwd resolves to (or can't be verified outside) the main checkout. **Git redirects** —
> blocks a command that redirects git into the main checkout via `git -C`, `--git-dir`,
> `GIT_DIR`/`GIT_WORK_TREE`, or a `cd` before running git. **Command shape** — blocks a
> command it can't statically verify stays inside the worktree (e.g. unquoted heredocs, brace
> expansion). You can't turn this check off."

**Subagent-level worktree isolation** — directly applicable to a multi-agent factory where
several BUILDER instances might run concurrently on different tickets:
> Add `isolation: worktree` to a custom subagent's frontmatter to make it always run in its
> own worktree:
> ```markdown
> ---
> name: refactorer
> description: Applies mechanical refactors across many files
> isolation: worktree
> ---
> Apply the requested refactor across every affected file, then run the tests and report the results.
> ```
> "Each subagent gets a temporary worktree that Claude Code removes automatically when the
> subagent finishes without changes; a worktree with changes stays on disk until the
> periodic sweep can remove it without losing work."
> Base-branch control: `worktree.baseRef: "head"` branches from the current local HEAD
> (carrying in-progress work) instead of the default `"fresh"` (clean checkout of the remote
> default branch) — useful when a BUILDER subagent needs to build on a PLANNER's
> already-committed scaffolding rather than starting from `main`.

**Branching straight from a PR/ticket:** `claude --worktree "#1234"` fetches that PR/MR's
head commit and creates the worktree at `.claude/worktrees/pr-1234` — directly reusable for
"BUILDER picks up ticket, opens a worktree scoped to that ticket's branch."

**Comparison with other parallelism primitives** (from Common Workflows / worktrees docs):
worktrees isolate **files**; **subagents** and **agent teams** isolate/coordinate **work**.
"Worktrees are one of several ways to run Claude in parallel. They isolate file edits, while
subagents and agent teams coordinate the work itself."

---

## 6. Commit/PR hygiene for agent-authored code

- No public `CONTRIBUTING.md` exists in the `anthropics/claude-code` GitHub repo (checked
  directly via `gh api repos/anthropics/claude-code/contents/CONTRIBUTING.md` → 404); the
  repo is a distribution repo for the CLI binary/plugins, not a typical PR-driven OSS
  project, so it has no public commit-message style guide to cite.
- The de facto convention, however, is embedded in Claude Code's own default commit
  behavior: agent-authored commits carry a `Co-Authored-By: Claude <noreply@anthropic.com>`
  trailer (plus, in some integrations, a session-link trailer), keeping git history
  attributable without needing a separate audit log. Recommend the factory standardize on an
  equivalent trailer per pipeline stage.
- Documented conventions that *do* generalize:
  - CLAUDE.md should encode "**Repository etiquette (branch naming, PR conventions)**" per
    the best-practices doc's CLAUDE.md do/don't table, so every agent in the pipeline
    inherits the same hygiene rules without being re-told each session.
  - PRs should be **generated with `gh pr create`** (Claude "knows how to use it for
    creating issues, opening pull requests, and reading comments") and the session
    auto-links to the PR it created: "When you create a PR using `gh pr create`, the session
    is automatically linked to that PR. To find it later, run `claude --from-pr 1234`."
  - Human/next-stage review of agent-authored PRs is explicitly expected, not optional:
    "Review Claude's generated PR before submitting and ask Claude to highlight potential
    risks or considerations."
  - The GitHub Actions integration enforces a **human-write-access gate** on who can trigger
    an agent to push commits at all: "the triggering user must have write access to the
    repository," and rejects bot actors by default to prevent trigger loops: "the Claude
    Code GitHub Action rejects a bot actor unless you list it in `allowed_bots`, which keeps
    bots from triggering Claude in a loop."

---

## 7. Handling ambiguity: ask a human vs. decide and log it

Synthesis across sources — there isn't one canonical "ambiguity decision tree" doc, but the
guidance is consistent:

- **Building effective agents**: agents should "pause for human feedback at checkpoints or
  when encountering blockers," bounded by explicit "stopping conditions (such as a maximum
  number of iterations)" so ambiguity/looping doesn't run forever unattended.
- **Best-practices doc — "Let Claude interview you"**: for anything large/ambiguous enough to
  need a spec, resolve ambiguity *before* implementation starts, via an explicit interview
  step using the `AskUserQuestion` tool, and freeze the outcome into a written artifact
  (SPEC.md) before a fresh, focused execution session begins. This effectively pushes
  ambiguity-resolution upstream into the PLANNER stage of a factory pipeline rather than
  leaving it to BUILDER improvisation.
- **Best-practices doc — plan mode framing**: "Planning is most useful when you're uncertain
  about the approach … If you could describe the diff in one sentence, skip the plan." This
  is a usable heuristic for a BUILDER: if the design doc leaves the implementation approach
  genuinely uncertain (not just under-specified in a resolvable way), that's a signal to
  escalate/replan rather than guess; if the ambiguity is a small, one-sentence-describable
  gap, a reasonable default decision + a documented note is proportionate.
- **Best-practices doc — correction loop**: "If you've corrected Claude more than twice on
  the same issue in one session, the context is cluttered with failed approaches … A clean
  session with a better prompt almost always outperforms a long session with accumulated
  corrections" — an operational trigger for a factory: after N failed self-corrections on
  the same ambiguity, stop and escalate rather than keep guessing in a polluted context.
- **Best-practices doc — auto mode fallback**: even in fully autonomous non-interactive runs,
  Anthropic's own classifier-gated "auto mode" is designed to *block* (not guess through)
  actions that look like scope escalation or hit unknown infrastructure, rather than let the
  agent freelance past uncertain territory: "A classifier model reviews commands before they
  run, blocking scope escalation, unknown infrastructure, and hostile-content-driven
  actions." When the classifier repeatedly blocks in a non-interactive run, "Claude Code
  doesn't stop the run" outright but falls back to a defined behavior rather than silent
  guessing (see `/docs/en/permission-modes#when-auto-mode-falls-back`).

**Synthesized rule of thumb for a BUILDER role:** resolve ambiguity locally and document the
decision + rationale in the handoff notes when (a) the choice is reversible/low-blast-radius,
(b) it's describable in one sentence, and (c) it doesn't touch anything the design doc
explicitly called out as a hard constraint. Escalate/stop when (a) the ambiguity changes the
implementation *approach* rather than a detail, (b) two or more self-corrections have already
failed on the same point, or (c) the decision would expand scope/permissions beyond what the
ticket granted.

---

## 8. Context handoff notes for the next agent (REVIEWER)

Two relevant mechanisms, one about *what* an agent hands off and one about the *infrastructure*
for handing it off.

### 8.1 What to hand off — "Effective context engineering for AI agents" (anthropic.com/engineering/effective-context-engineering-for-ai-agents, Sep 29, 2025)
URL: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

**Structured note-taking as an explicit, reusable pattern for cross-session handoff:**
> "the agent regularly writes notes persisted to memory outside of the context window. These
> notes get pulled back into the context window at later times." Benefits: "persistent
> memory with minimal overhead" and the ability to "track progress across complex tasks,
> maintaining critical context and dependencies." Demonstrated behavior: an agent "develops
> maps of explored regions" and "maintains strategic notes" without being told the memory
> format explicitly, and after a context reset "the agent reads its own notes and
> continues." Anthropic's own tooling supports this so agents can "build up knowledge bases
> over time, maintain project state across sessions, and reference previous work."

**Sub-agent architecture for handing off condensed findings rather than raw exploration:**
> "specialized sub-agents can handle focused tasks with clean context windows." Each
> subagent "might explore extensively" but "returns only a condensed, distilled summary" to
> the coordinator, typically **1,000–2,000 tokens** — a concrete size target for what a
> BUILDER's handoff note to REVIEWER should look like (a distilled summary, not a transcript
> dump).

**Compaction (relevant if BUILDER's own session runs long before handoff):**
> Compaction is "taking a conversation nearing the context window limit, summarizing its
> contents, and reinitiating a new context window," aiming to "distill the contents of a
> context window in a high-fidelity manner." Guidance: "start by maximizing recall to ensure
> your compaction prompt captures every relevant piece of information," then iterate to
> improve precision.

### 8.2 Infrastructure for handoff — subagents and agent teams
From https://code.claude.com/docs/en/sub-agents:
> A subagent "does that work in its own context and returns only the summary" to the caller.
> Example output-shape conventions worth copying for a BUILDER→REVIEWER handoff schema (from
> the doc's built-in subagent examples): a **Code Reviewer** returns findings "organized by
> priority: Critical issues (must fix) / Warnings (should fix) / Suggestions (consider
> improving)" with "specific examples of how to fix issues"; a **Debugger** returns, per
> issue, "Root cause explanation / Evidence supporting the diagnosis / Specific code fix /
> Testing approach / Prevention recommendations."
> Subagents can be **resumed** with full history intact: "Resumed subagents retain their
> full conversation history, including all previous tool calls, results, and reasoning. The
> subagent picks up exactly where it stopped" — relevant if REVIEWER needs to send work back
> to the same BUILDER instance rather than starting a fresh one.

From https://code.claude.com/docs/en/agent-teams (experimental, but architecturally
instructive for a persistent multi-role factory):
> Team members coordinate via "a shared task list, messaging, and a team lead." Tasks have
> "three states: pending, in progress, and completed" and "can also depend on other tasks: a
> pending task with unresolved dependencies cannot be claimed until those dependencies are
> completed" — directly analogous to a ticket moving through PLANNER→BUILDER→REVIEWER→
> DOCUMENTER states with dependency gating.
> Hooks exist specifically to **enforce quality gates at task-completion time**:
> `TaskCompleted` — "runs when a task is being marked complete. Exit with code 2 to prevent
> completion and send feedback." This is the closest documented analog to "block a ticket
> from moving to 'In Review' until its definition-of-done is actually met," implementable
> today even outside the experimental agent-teams feature via a Stop hook (§3).
> On why teammates need explicit handoff context rather than assumed shared history: "Each
> teammate has its own context window… It also receives the spawn prompt from the lead. The
> lead's conversation history does not carry over" — reinforcing that a BUILDER cannot assume
> REVIEWER inherits any context; everything relevant must be written into the handoff
> artifact (ticket comment / PLAN.md diff / structured note) explicitly.
> Idle/completion notifications carry no payload by design: "The notification doesn't carry
> the teammate's output; a teammate shares results by messaging the lead or updating the
> shared task list" — i.e., completion signal and result payload are deliberately separate;
> a factory's ticket system should likewise treat "moved to In Review" as a signal, with the
> actual handoff content (decisions, deviations, open questions, verification evidence)
> living in the ticket body/comments, not inferred from the state transition alone.

**Design implication for BUILDER's handoff note to REVIEWER**, synthesizing 8.1 and 8.2:
a short (roughly 1-2k token) structured artifact, written to the ticket/PR rather than
assumed as shared context, containing: (1) what was implemented and where, (2) verification
evidence (test/build/lint output, not just an assertion of success), (3) any deviations from
the design doc and why, (4) any ambiguities resolved locally with rationale (per §7), and
(5) any explicitly open questions left for REVIEWER or a human.

---

## Sources (full list)

- Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- Claude Code best practices (current, canonical) — https://code.claude.com/docs/en/best-practices
- Claude Code best practices (original blog URL, 308-redirects to the above) — https://www.anthropic.com/engineering/claude-code-best-practices
- Claude Code hooks reference — https://code.claude.com/docs/en/hooks
- Claude Code worktrees — https://code.claude.com/docs/en/worktrees
- Claude Code common workflows — https://code.claude.com/docs/en/common-workflows
- Claude Code sub-agents — https://code.claude.com/docs/en/sub-agents
- Claude Code agent teams — https://code.claude.com/docs/en/agent-teams
- Claude Code GitHub Actions — https://code.claude.com/docs/en/github-actions
- Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- How we contain Claude — https://www.anthropic.com/engineering/how-we-contain-claude
- Demystifying evals for AI agents — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Anthropic engineering blog index (for dating/locating the above) — https://www.anthropic.com/engineering
- anthropics/claude-code GitHub repo (checked for CONTRIBUTING.md/README conventions; no
  CONTRIBUTING.md exists) — https://github.com/anthropics/claude-code

### Sources attempted but unreachable this session
- General WebSearch — blocked for the entire session ("this session has used its web search
  budget (200 of 200) WebSearch calls"), so non-Anthropic community writeups (e.g. independent
  blog posts on Claude-Code TDD loops or worktree parallelism) could not be discovered via
  search.
- Google, DuckDuckGo (both the JS and `/lite/` endpoints), Bing, Mojeek — all returned CAPTCHA
  challenges, consent pages, or no usable result markup when fetched directly.
- web.archive.org — fetch tool explicitly refused ("Claude Code is unable to fetch from
  web.archive.org"), so the original (pre-consolidation) April 2025 wording of the Claude
  Code best-practices blog post could not be recovered verbatim; the current
  code.claude.com/docs/en/best-practices version (quoted above) is Anthropic's maintained
  successor to that post.
- harper.blog (Harper Reed's "My LLM codegen workflow atm") — 403 Forbidden.
- simonwillison.net — the one URL guessed (claude-trace post) was reachable but not on-topic
  for TDD/worktrees/verification gates.

---

# 4. Review: multi-lens and adversarial AI code review

# Multi-Perspective / Adversarial AI Code Review — Research Findings

Research date: 2026-08-18. Compiled for a report on AI-agent software development methodologies, focused on a "REVIEWER" role in a personal agentic software factory pipeline (BUILDER implements → REVIEWER spins up multiple reviewers with different lenses → builder addresses findings → ticket moves to "Done").

**Note on search tooling:** WebSearch was unavailable (session budget exhausted by prior use). All findings below come from direct WebFetch of vendor docs, blog posts, GitHub repos, and arXiv abstracts. DuckDuckGo/Bing HTML scraping via WebFetch was attempted for the generic academic/pattern-name searches but was blocked by CAPTCHA or returned only dictionary junk — noted inline where a gap remains.

---

## 1. Multi-lens review concept (parallel review passes with different personas)

### Claude Code's own "fleet of specialized agents" (best direct example of the pattern)
Source: [Claude Code — Code Review docs](https://code.claude.com/docs/en/code-review)

> "Code Review analyzes your GitHub pull requests and posts findings as inline comments on the lines of code where it found issues. A fleet of specialized agents examine the code changes in the context of your full codebase, looking for logic errors, security vulnerabilities, broken edge cases, and subtle regressions."

> "When a review runs, multiple agents analyze the diff and surrounding code in parallel on Anthropic infrastructure. Each agent looks for a different class of issue, then a verification step checks candidates against actual code behavior to filter out false positives. The results are deduplicated, ranked by severity, and posted as inline comments..."

This is the clearest first-party articulation of "different lenses running in parallel, then deduplicated/ranked" — directly matches the REVIEWER-spins-up-multiple-reviewers pattern.

### Ultrareview — deeper multi-agent cloud review
Source: [Claude Code — ultrareview docs](https://code.claude.com/docs/en/ultrareview)

> "Ultrareview is a deep code review that runs on Claude Code on the web infrastructure. When you run `/code-review ultra`, Claude Code launches a fleet of reviewer agents in a remote sandbox to find bugs in your branch or pull request."

Compared to local review, ultrareview offers:
> "**Higher signal**: every reported finding is independently reproduced and verified, so the results focus on real bugs rather than style suggestions. **Broader coverage**: a larger fleet of reviewer agents explores the change in parallel, which surfaces issues that a local review can miss."

Comparison table row: Depth — `/code-review` "scales with the effort argument" vs `/code-review ultra` "multi-agent fleet with independent verification." Duration ~5-10 min, cost ~$5-25/review (billed as usage credits after free runs: 3 free runs on Pro/Max, none on Team/Enterprise).

### CodeRabbit's parallel-specialist "Hunt" stage (security-specific but same pattern)
Source: [Introducing CodeRabbit Security](https://www.coderabbit.ai/blog/introducing-coderabbit-security)

> "**Hunt Stage:** Specialized agents investigate different risk areas in parallel, including authorization, injection, business logic, data exposure, and AI-specific threats." The system "traces attacker-controlled input from entry point through to its destination."

### Qodo's "Deep" mode — multiple models/reasoning approaches in parallel
Source: [The Right Depth for Every PR: Introducing Review Effort Modes](https://www.qodo.ai/blog/the-right-depth-for-every-pr-introducing-review-effort-modes/) (Qodo blog, Elana Krasner, Jul 28 2026)

> "**Deep**: Multi-pass analysis combining independent models and different reasoning approaches to uncover subtle bugs that a single pass might miss. It is intended for complex changes."

> "Review depth also depends on how many analysis passes are performed, how much reasoning each pass applies, and how findings are combined." Each mode packages "appropriate models, reasoning effort, and review architecture into a defined level of scrutiny."

### Academic: CodeAgent (multi-agent, task-specialized reviewers with a supervisory QA-Checker)
Source: arXiv, "CodeAgent: Autonomous Communicative Agents for Code Review" — Tang, Kim, Song, Lothritz, Li, Ezzini, Tian, Klein, Bissyande. http://arxiv.org/abs/2402.02172v5

> A multi-agent system incorporating a supervisory agent (QA-Checker) to ensure all contributions address review questions, across four tasks: detecting inconsistencies between code and commit messages, identifying vulnerabilities, validating style adherence, and suggesting revisions. Claims "state-of-the-art in code review automation."

### Academic: personality/emotion profiles affect multi-agent review team behavior
Source: arXiv, "Agents with Feelings? Personality and Emotion in Multi-Agent Software Teams" — Ding, Zimmermann, Ahmed. http://arxiv.org/abs/2607.05659v1

> Investigates how personality and emotion profiles affect multi-agent LLM team performance in code generation and review tasks. "Profile choice substantially affects both performance and team behavior," with performance gaps of 7.1–11.3 percentage points between configurations. (Relevant to the "different lenses/personas" framing — persona choice is not cosmetic, it measurably changes what gets caught.)

### Gap noted
Direct web-search results for generic phrases like "multi-agent code review" / "parallel code review lenses AI" as a named industry pattern (e.g., a canonical blog post coining the term) could not be retrieved — DuckDuckGo returned a CAPTCHA wall and Bing's WebFetch rendering returned only dictionary definitions, not real SERPs. The concept is well evidenced through direct vendor/product documentation and academic papers above instead.

---

## 2. Adversarial verification (a second agent tries to REFUTE findings)

### Claude Code best practices — the clearest first-party framing of "adversarial review step"
Source: [Claude Code — Best Practices](https://code.claude.com/docs/en/best-practices), section "Add an adversarial review step"

> "The longer Claude works unattended, the more an independent check matters before you count the work as done. A reviewer running in a fresh subagent context sees only the diff and the criteria you give it, not the reasoning that produced the change, so it evaluates the result on its own terms."

> "Because the reviewer runs as a subagent, the implementing session receives the gaps directly and can fix them and re-review without you copying findings between windows."

Warning about over-triggering (important nuance for a report on false-positive reduction):
> "A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do. Chasing every finding leads to over-engineering: extra abstraction layers, defensive code, and tests for cases that can't happen. Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional."

Same doc, on gating a check with "a second opinion":
> "**By a second opinion**: a verification subagent or a dynamic workflow that checks its own findings has a fresh model try to refute the result, so the agent doing the work isn't the one grading it."

Also documents a concrete **Writer/Reviewer** two-session pattern:
> Session A (Writer): `Implement a rate limiter for our API endpoints`
> Session B (Reviewer): `Review the rate limiter implementation in @src/middleware/rateLimiter.ts. Look for edge cases, race conditions, and consistency with our existing middleware patterns.`
> Session A: `Here's the review feedback: [Session B output]. Address these issues.`
> "Beyond parallelizing work, multiple sessions enable quality-focused workflows. A fresh context improves code review since Claude won't be biased toward code it just wrote."

### Claude Code's production review pipeline: literal "verification step" against actual behavior
Source: [Claude Code — Code Review docs](https://code.claude.com/docs/en/code-review)

> "Each agent looks for a different class of issue, then a verification step checks candidates against actual code behavior to filter out false positives."

Findings carry a "collapsible extended reasoning section you can expand to understand why Claude flagged the issue **and how it verified the problem**" — i.e., the verification trace is surfaced to the human, not just the raw claim.

### CodeRabbit — explicit "reviewer challenges and re-reviews" adversarial loop
Source: [Better models don't solve a judgment bottleneck](https://www.coderabbit.ai/blog/better-models-dont-solve-a-judgment-bottleneck) (CodeRabbit blog, Brandon Gubitosa)

> "a coding agent creates and fixes, a CodeRabbit reviewer challenges and re-reviews, and the two cycle until the change holds up."

> This separate reviewer layer applies "organizational standards" and can "test suspected failure modes" before human judgment determines whether to ship — explicitly reducing reliance on the initial authoring model's own assumptions about its own correctness (i.e., not letting the author grade its own work — same principle as Claude Code's "the agent doing the work isn't the one grading it").

> On the underlying problem this solves: "AI has scaled code generation far faster than the human attention, context, and accountability needed to absorb it, and that gap is where the pressure now sits." Citing research that AI tools increased coding activity by 180% while actual releases grew only 30%: "code is now plentiful, but judgment about what deserves to merge is not."

### CodeRabbit Security — a 4-stage pipeline with an explicit Verify stage that rejects unsupported claims
Source: [Introducing CodeRabbit Security](https://www.coderabbit.ai/blog/introducing-coderabbit-security)

> "**Verify Stage:** Before CodeRabbit publishes a finding, it has to hold up under independent verification." The process "checks code reachability, examines safeguards, validates exploitation conditions, and removes duplicates."

> False positives are actively rejected when they "depend on test-only or unreachable code, overlook existing protections, or rest on unsupported assumptions."

> Crucially, on epistemic honesty rather than forced verdicts: **"when the evidence doesn't support a conclusion either way, CodeRabbit says so rather than treating incomplete analysis as proof."** (This is a strong, quotable design principle for a report: refuse-to-conclude beats false-confidence.)

Stages in full: Map (build a system-level map, trust boundaries, reachability graph) → Hunt (parallel specialist agents per risk area) → Verify (independent verification before publishing) → Fix (scoped remediation PR for confirmed findings).

### Greptile v3 — "self-scrutiny" / hypothesis-challenging to raise the confidence bar
Source: [Greptile v3, an agentic code review](https://www.greptile.com/blog/greptile-v3-agentic-code-review)

> Greptile v3 runs "in a loop, with access to key tools such as codebase search and accessing learned rules," enabling multi-hop reasoning across the codebase before committing to a finding.

> Higher precision comes from "an increased threshold for 'sureness' since v3 can challenge its own hypothesis more strongly," so that "lower confidence comments can be safely eliminated." Reported outcome: action/acceptance rate rose from 34.75% to 59.24% v2→v3 (elsewhere the vendor cites "256% better upvote/downvote ratios" for the agentic vs. non-agentic approach — see Section 4).

### GitHub Action: claude-code-security-review — filtering layer as a lighter-weight verification analog
Source: [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review)

> Employs "automatic false positive filtering" that excludes low-impact classes by default (DoS, rate limiting, memory/CPU exhaustion, generic input validation without proven impact, open redirects), tunable via a `false-positive-filtering-instructions` file pointing to org-specific guidance. This is filtering/triage rather than a true adversarial second-agent refutation step, but serves the same false-positive-reduction goal.
> Explicit caveat: **"the action is not hardened against prompt injection and should only review trusted PRs."** Recommendation to require maintainer approval before running on external-contributor PRs.

### Academic: AgenticSCR — human-in-the-loop validation as the real-world adversarial/verification check
Source: arXiv, "AgenticSCR: An Autonomous Agentic Secure Code Review for Immature Vulnerabilities Detection" — Charoenwet, Tantithamthavorn, Thongtanunam, Lin, Jeong, Wu. http://arxiv.org/abs/2601.19138v2

> "AgenticSCR achieves at least 153% relative improvement in generating comments with correct localization, vulnerability type, and relevance over static LLM baseline, multi-agent reviewer, and SAST tools. In a shadow deployment, 54% of its comments were validated by security engineers for developer reporting, demonstrating practical utility while underscoring the difficulty of the task."

This is a useful real-world data point for a report: even a strong agentic reviewer only clears human validation about half the time in shadow deployment — i.e., human verification remains load-bearing, and the "54%" number is a concrete anchor for how much automated adversarial verification narrows (but doesn't eliminate) the human review burden.

### Related academic (adjacent, not core to the pattern but worth flagging)
- arXiv 2607.24964v1, "ALIBI: Adaptive Agentic Attacks on LLM-Based Vulnerability Detectors via Adversarial Code Comments" — Wu, Nita-Rotaru. Shows the flip side: adversarially crafted code comments can fool LLM vulnerability detectors, with "attack success rates exceed 90%" in some cases — a caution about how "adversarial" cuts both ways (attacking the reviewer, not just refuting its findings).

### Anthropic's general pattern vocabulary: "evaluator-optimizer"
Source: [Anthropic Engineering — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)

> The evaluator-optimizer workflow is "a two-LLM loop where one generates responses while another provides evaluation and feedback iteratively." "This workflow is particularly effective when we have clear evaluation criteria, and when iterative refinement provides measurable value," specifically when "LLM responses can be demonstrably improved when a human articulates their feedback" and "the LLM can provide such feedback."
> On human oversight: "human review remains crucial for ensuring solutions align with broader system requirements," and agents generally "can pause for human feedback at checkpoints or when encountering blockers."

This is Anthropic's canonical name for the generator/critic loop that underlies adversarial verification in code review — useful as the theoretical frame to cite alongside the vendor-specific implementations above.

---

## 3. Claude Code's own /code-review and "ultrareview" capabilities

Full docs fetched directly: [code.claude.com/docs/en/code-review](https://code.claude.com/docs/en/code-review) and [code.claude.com/docs/en/ultrareview](https://code.claude.com/docs/en/ultrareview).

### `/code-review` (local, effort-scaled)
- Aliases: `/review` is an alias of `/code-review` (as of Claude Code v2.1.223).
- Effort levels: pass an effort level to trade coverage for confidence — **low/medium/high/max**, plus **ultra** as a distinct escalation:
  > "Pass an effort level to trade coverage for confidence. At `low` and `medium`, the review reports only the findings it's most confident in, so you see fewer false positives; `high` through `max` broaden coverage and may include findings the review is less sure about."
  - If no level is typed, it reuses the last level typed (persists across sessions); `ultra` never updates or uses the remembered level.
- Flags: `--fix` (apply findings to working tree), `--comment` (post as inline PR comments), `--post` (on an `ultra` review of a github.com PR, preselect posting the finished findings to the PR as a plain comment from the user's GitHub account — requires v2.1.227+, always reconfirmed in interactive sessions).
- Runs as a **background forked subagent** with its own context window by default (since v2.1.218) so it doesn't fill the main conversation; findings arrive as a notification. Can be forced to foreground (e.g., non-interactive `-p` runs, or if a prior review is still in progress).
- What it checks by default: "Claude reports the findings as... a category tag such as `correctness`" — the bundled skill "reviews the current diff for bugs" and "reuse, simplification, efficiency cleanups," historically named `/simplify` pre-v2.1.147.
- Customization for the managed GitHub-integrated version (not the local command) via two files with different precedence:
  - **`CLAUDE.md`**: general project instructions; violations introduced by a PR become **nit-level** findings only.
  - **`REVIEW.md`**: review-only, injected as **highest-priority** instruction into every agent in the review pipeline. Explicitly documented tunable levers, verbatim from docs:
    > "**Severity**: redefine what 🔴 Important means for your repo... **Nit volume**: cap how many 🟡 Nit comments a single review posts... **Skip rules**: list paths, branch patterns, and finding categories where Claude should post no findings... **Repo-specific checks**: add rules you want flagged on every PR... **Verification bar**: require evidence before a class of finding is posted. For example, 'behavior claims need a `file:line` citation in the source, not an inference from naming'... **Re-review convergence**: tell Claude how to behave when a PR has already been reviewed. A rule like 'after the first review, suppress new nits and post Important findings only' stops a one-line fix from reaching round seven on style alone. **Summary shape**: ask for the review body to open with a one-line tally such as `2 factual, 4 style`..."
  - This "Re-review convergence" lever is directly relevant to Section 5 (fix loops) — it's Anthropic's own documented mechanism for preventing infinite review/fix cycling on trivial issues.

### Managed GitHub "Code Review" product (org-level, PR-triggered)
- Research preview, Team/Enterprise only, not available with Zero Data Retention enabled.
- Trigger modes per repo: **Once after PR creation**, **After every push**, or **Manual** (`@claude review` / `@claude review always` / `@claude review once`).
- **Severity levels** (verbatim table):

| Marker | Severity | Meaning |
|---|---|---|
| 🔴 | Important | A bug that should be fixed before merging |
| 🟡 | Nit | A minor issue, worth fixing but not blocking |
| 🟣 | Pre-existing | A bug that exists in the codebase but was not introduced by this PR |

- Findings are **deduplicated, ranked by severity**, posted as inline PR comments **plus** a "Claude Code Review" GitHub check run with a machine-parseable severity breakdown (`{"normal": 2, "nit": 1, "pre_existing": 0}` via a documented `gh api ... --jq` incantation).
- **The check run always completes with a "neutral" conclusion — it never blocks merge via branch protection.** Verbatim: "The check run always completes with a neutral conclusion so it never blocks merging through branch protection rules. If you want to gate merges on Code Review findings, read the severity breakdown from the check run output in your own CI." This is an important design decision for the report's "does severity block merge" question — Anthropic's own product deliberately does **not** auto-gate merge; gating is left to the customer's own CI.
- Feedback loop: 👍/👎 react to each finding; Anthropic "collects reaction counts after the PR merges and uses them to tune the reviewer," but reactions don't trigger a re-review.
- Pricing: $15-25 average per review, billed as usage credits, scaling with PR size/complexity and "how many issues require verification."

### Ultrareview (`/code-review ultra`, cloud, deepest tier)
- "Launches a fleet of reviewer agents in a remote sandbox." Every finding is "independently reproduced and verified." 5–10 minutes typical, $5–25/review after 3 free runs (Pro/Max only; none free on Team/Enterprise).
- Diff size limits: up to 500 changed files / 8,000 changed lines for a branch review by default (values may change; refusal message states current values).
- Can post findings straight to a github.com PR as a plain (non-review, non-blocking) comment from the user's own GitHub account, ending with a "Generated by Claude Code" note — an explicit human-attribution/accountability design choice.
- Non-interactive/CI entrypoint: `claude ultrareview` subcommand (blocks until done, `--json`, `--timeout`, `--post`/`--no-post` flags).

### Security review
- No standalone "/security-review" *skill* in the docs fetched, but there is a companion GitHub Action product: **anthropics/claude-code-security-review** (see Section 2 above for methodology) plus a `/security-review` slash command usable inside Claude Code sessions, customizable via `.claude/commands/security-review.md`. It checks for injection (SQL/command/LDAP/XPath/NoSQL/XXE), auth/authz flaws, data exposure (secrets, PII, logging), crypto weaknesses, input validation gaps, business-logic races/TOCTOU, insecure config/CORS, supply-chain risk, RCE via deserialization, and XSS variants. Uses diff-aware scanning (PR-changed files only) plus a documented false-positive filtering layer.
- Claude Code also ships a general-purpose "security-review" *skill* (referenced in this environment's own skill list as "Complete a security review of the pending changes on the current branch") — confirms Anthropic treats security review as a distinct lens from general correctness review, matching the report's "different lenses" framing.

---

## 4. Commercial AI code review tools

### CodeRabbit (coderabbit.ai) — richest methodology writeup of the five
- **Categories/lenses** (from docs.coderabbit.ai): Security & Privacy ("vulnerabilities, authentication and authorization flaws, secret handling, and data exposure"), Stability & Availability ("crashes, unhandled errors, resource leaks, and reliability risks"), Data Integrity & Integration ("data correctness, persistence, schema, and integration-boundary issues"), Functional Correctness ("logic errors, incorrect behavior, and unhandled edge cases"), Performance & Scalability, Maintainability & Code Quality.
- **Severity tiers**: Critical, Major, Minor, Trivial, Info (5 levels).
- **False-positive reduction**: "a multi-layered approach that combines the best of AI and industry-standard tools," integrating "50+ open-source linters and security scanners" alongside the LLM layer; plus the explicit adversarial "reviewer challenges and re-reviews" loop and the security-specific Verify stage (both quoted in full in Section 2).
- **Multi-pass**: yes — incremental reviews on each subsequent commit "focusing on the new changes" while retaining conversation context (sequential, not simultaneous multi-pass).
- **Presentation**: inline PR comments with category badges/severity labels, plus AI-generated PR summary/"walkthrough."
- **Post-merge follow-through**: distinct "Post-Merge Actions" feature — reviewer-proposed actions (code changes via follow-up PR, text reports, or MCP-tool-driven actions like filing a ticket) are pre-approved via checkbox during review, then executed after merge, posting one result comment. ([Close the loop after every merge](https://www.coderabbit.ai/blog/close-the-loop-after-every-merge))
- Relevant blog corpus found: "Opus 5 for code review: Cleaner actionable comments, noisier overall" (`/blog/opus-5-model-review`); "Teaching NVIDIA Nemotron 3.5 Lightning to route code reviews"; "Better models don't solve a judgment bottleneck"; "The three hidden attention taxes derailing the agentic SDLC."

### Greptile (greptile.com) — good depth on architecture/verification, thin on named severity levels
- **Architecture**: builds "a graph index of your codebase" mapping files/functions/dependencies so agents can "assess their impact beyond the diff," rather than reviewing the diff in isolation.
- **v3 "agentic" self-scrutiny loop**: runs in a loop with codebase-search tool access, challenges its own hypotheses before surfacing a finding, discarding low-confidence candidates (full quotes in Section 2). Vendor-reported outcome: "256% better upvote/downvote ratios" and action rate up from 34.75% to 59.24% vs. v2. v4 claims "74% more addressed comments and 43% comment acceptance rate."
- **Learning/feedback loop**: "Your 👍/👎 reactions and replies teach Greptile what matters. After 2-3 weeks, it stops commenting on things you don't care about."
- **Fix loop integration**: "Fix with your Agent" — each PR comment includes a button sending "the issue — with file paths, line numbers, and suggested code" straight to Claude Code, Codex, Conductor, Cursor, or Devin; also MCP connectivity and an iterative "/greploop" workflow mentioned in marketing copy (could not fetch a dedicated docs page describing `/greploop` mechanics — docs.greptile.com connection failed and the general docs page didn't detail it).
- **Presentation**: PR inline comments; ~3-minute average review time; vendor claims "100K+ bugs caught monthly," "9x faster merge velocity."
- **Gap**: no explicit named severity taxonomy (Critical/Major/etc.) surfaced in fetched pages, unlike CodeRabbit, Claude Code, or Graphite.

### Graphite Diamond (graphite.com/diamond, formerly graphite.dev) — moderate depth
- **Categories** (7, from product page): logic bugs, potential edge cases, security issues, performance problems, code style/quality, documentation issues, accidentally committed code.
- **False-positive control**: teams can "define information to consider when determining types of comments not to leave"; vendor claims "less than 5% negative comment rate."
- **Speed**: "analyzes every pull request in seconds."
- **Presentation**: inline GitHub comments with "1-click fixes" — "accept AI-powered suggestions or customize the fix," commit recommendations directly.
- **Gap**: no explicit severity-level taxonomy or multi-pass/multi-agent methodology detail surfaced (page focuses on product features, not internal architecture).

### Ellipsis (ellipsis.dev) — thin, but confirmed still active
- **Status**: still active and operating independently as "Ellipsis AI Inc.," backed by Y Combinator W24. No evidence found of a rename or acquisition. (Live usage counter shown on site: "128 Sessions today," "$41.70 Spend" — i.e., a real-time public demo/counter.)
- **Distinctive positioning**: infrastructure for *custom* reviewers rather than a fixed set of built-in lenses — teams define reviewers via YAML with their own system prompts and file-path scoping (example: a "bugs" reviewer and a "migration-reviewer" scoped to `migrations/**`). Tagline: "Code review with your prompts and your models," "Choose the models and prompts, add multiple reviewers." Positions itself as "infrastructure enabling teams to gate what lands with a filter you write."
- **Presentation**: GitHub PR integration, permanent/searchable session transcripts as an audit trail, cost/token-usage dashboard.
- **Gap**: no severity taxonomy, no stated false-positive-reduction methodology beyond "you write your own filter/prompt" — this is the thinnest of the five on methodology because the product's whole premise is that methodology is left to the customer.

### Cursor Bugbot (cursor.com/bugbot) — good depth on false-positive philosophy
- **Focus**: general "logic bugs" rather than a named category taxonomy — "the hardest logic bugs with a low false positive rate." Examples cited: state-mutation issues (shared object modification), unit mismatches (ms vs. seconds), integration problems between new and existing code.
- **False-positive philosophy — optimizes for outcomes, not raw finding count**: "Bugbot optimizes for bugs that get fixed. 70%+ of flags get resolved before merge," and "more than half of the bugs that we find are ultimately fixed by engineers." This is a notably different framing from CodeRabbit/Greptile's verification-step approach: Bugbot's quoted metric for quality is *downstream fix rate*, not an internal verification pass.
- **Model approach**: "a combination of frontier and in-house models to review code" (implies some internal specialization/routing, though not detailed as multi-agent).
- **Presentation**: GitHub PR comments with proposed fixes, plus Cursor editor integration and a "Background Agent" mode.
- **Gap**: no stated severity taxonomy or explicit multi-pass architecture (docs.cursor.com/bugbot 404'd/redirected during fetch; information above comes from the cursor.com/bugbot marketing page).

### Summary table (solid info vs. thin)

| Tool | Depth of info obtained |
|---|---|
| CodeRabbit | **Solid** — categories, 5-tier severity, adversarial re-review loop, 4-stage security pipeline, multi-pass, post-merge actions |
| Greptile | **Solid on architecture/verification**, but no named severity taxonomy found |
| Graphite Diamond | **Moderate** — 7 categories, false-positive rate claim, presentation; no severity tiers or architecture detail |
| Cursor Bugbot | **Moderate-solid** — clear false-positive philosophy (fix-rate framing) and category examples; no severity taxonomy or architecture detail |
| Ellipsis | **Thin** — confirmed active/independent, but the product deliberately has no fixed methodology (BYO prompts/reviewers), so there's little vendor-side methodology to report |

---

## 5. Fix loops / escalation patterns

### Claude Code's documented loop mechanics (most concrete source found)
Source: [Claude Code — Best Practices](https://code.claude.com/docs/en/best-practices)

Three concrete ways to gate a "done" signal, in increasing order of rigor:
> "**In one prompt**: ask Claude to run the check and iterate in the same message... **Across a session**: set the check as a `/goal` condition. A separate evaluator re-checks it after every turn and Claude keeps working until the goal resolves. If Claude stalls, Claude Code eventually stops the run with the goal still set... **As a deterministic gate**: a Stop hook runs your check as a script and blocks the turn from ending until it passes. **Claude Code overrides the hook and ends the turn after 8 consecutive blocks.**"

That "8 consecutive blocks" is a concrete, documented hard iteration ceiling for a builder/verifier loop — directly useful for a report section on max-iteration design.

> "Because the reviewer runs as a subagent, the implementing session receives the gaps directly and can fix them and re-review without you copying findings between windows. **For longer autonomous runs, an agent team can keep this loop going across many tasks while you spot-check the recorded findings.**"

This last sentence is the closest first-party description of exactly the pipeline the report is modeling (builder ↔ reviewer loop, human spot-checks rather than gates every cycle).

Failure-pattern guidance directly applicable to designing escalation triggers:
> "**Correcting over and over.** Claude does something wrong, you correct it, it's still wrong, you correct again. Context is polluted with failed approaches. > **Fix**: After two failed corrections, `/clear` and write a better initial prompt incorporating what you learned."
This is Anthropic's own documented rule of thumb for a max-retry threshold (2 failed corrections) before abandoning the loop and re-scoping — a useful anchor number distinct from the 8-block hook ceiling (that one is a hard technical stop; this one is a human-judgment heuristic for when to intervene).

### Claude Code's REVIEW.md "re-review convergence" lever (severity threshold / convergence policy, user-configurable)
Source: [Claude Code — Code Review docs](https://code.claude.com/docs/en/code-review)

> "**Re-review convergence**: tell Claude how to behave when a PR has already been reviewed. A rule like 'after the first review, suppress new nits and post Important findings only' stops a one-line fix from reaching round seven on style alone."

And on merge-blocking policy — Anthropic's own product explicitly refuses to auto-gate merge, delegating that decision to the org's CI:
> "The check run always completes with a neutral conclusion so it never blocks merging through branch protection rules. If you want to gate merges on Code Review findings, read the severity breakdown from the check run output in your own CI."

### CodeRabbit — cycle-until-holds-up loop, then hand off "higher-order" judgment to humans
Source: [Better models don't solve a judgment bottleneck](https://www.coderabbit.ai/blog/better-models-dont-solve-a-judgment-bottleneck)

> "a coding agent creates and fixes, a CodeRabbit reviewer challenges and re-reviews, and the two cycle until the change holds up." Human attention then focuses on the "higher-order work of weighing intent, architectural impact, acceptable risk" — i.e., the agent loop handles convergence on correctness; humans are reserved for judgment calls the loop can't resolve (risk tolerance, architectural fit).

> Severity/attention routing: low-risk changes get "fast-tracked through automated validation with focused human review"; high-risk changes get "deeper analysis with senior engineers and domain specialists"; low-value changes are "filtered out before consuming team attention." Prioritization weighs "value, risk, dependencies, readiness, and reviewer fit."

### Qodo — the loop is explicitly *not* fully agent-to-agent; a human always triages between review and remediation
Source: [Intro to Building a Quality-First AI Coding Workflow](https://www.qodo.ai/blog/intro-quality-coding-workflow/) (Nnenna Ndukwe, Qodo, Jul 23 2026)

Documented loop: **task → plan → implementation → local verification → pre-PR review → independent review → remediation → verification again**.

> "A code review finding is not resolved when a tool reports it. A developer must triage the finding, decide on the fix, implement it, and verify the result." And: "Treat remediation as part of implementation. Apply the fix, add or update the regression test, and rerun the targeted tests and full verification stack."

This is a notably different philosophy from Claude Code's/CodeRabbit's builder↔reviewer auto-loop: Qodo's documented workflow keeps a human in the loop at the triage step by design, rather than treating human review as an escalation path only for unresolved/high-severity cases. Worth flagging as a genuine methodological fork in the industry (agent-autonomous convergence vs. human-gated convergence) for the report.

### Qodo — architectural framing for *why* humans stay authoritative (very recent post, Aug 13 2026)
Source: [Moving from AI Code Review to the Outer SDLC Loop](https://www.qodo.ai/blog/moving-from-ai-code-review-to-the-outer-sdlc-loop/)

> "A review result contributes evidence. It does not own the durable state of that longer process." And: "A node reporting success cannot collapse all of these responsibilities into one claim."
Full documented lifecycle: **intent → context → plan → change → verification → review → remediation → approval → release evidence → learning**. The article frames this as separating *execution authority* (agents), *lifecycle authority* (the pipeline/system), and *human authority* (approval/merge/release) — i.e., an architectural argument for why review findings should never be treated as sufficient grounds for an agent to self-approve, no matter how many verification passes it ran. No specific iteration-count or severity-threshold numbers given (this post is explicitly architectural/conceptual, not an implementation spec).

### Qodo's adaptive router — a cost/depth escalation policy (not a fix-loop per se, but the same "when to spend more" logic)
Source: [Building an Adaptive Router for Code Review Depth](https://www.qodo.ai/blog/building-an-adaptive-router-for-code-review-depth/) (Dr. Ofir Friedman, Qodo, Jul 30 2026)

- Four tiers: **Fast** (single pass, light model), **Balanced** (default, one full pass on the benchmark-leading model), **Deep** (several passes, multiple models), **Auto** (router picks the tier or skips review entirely).
- Router optimizes `max(F1 − λ·cost)`, keyed primarily off **hunk count** (contiguous change blocks) rather than raw diff size — found to correlate better with real review difficulty than line count.
- **"Never-downgrade" rule**: "Uncertainty should produce a more capable review, not a lighter one" — i.e., when the router is unsure how risky a change is, it escalates depth rather than defaulting to cheap/shallow. This is a directly reusable design principle for a REVIEWER-role escalation policy.
- Reported results vs. fixed-depth-Deep baseline: 21% cost reduction, 30% token reduction, 27% faster, same F1.

### AgenticSCR — quantified example of the "how often does the loop actually resolve vs. need a human" question
Source: arXiv 2601.19138v2 (see Section 2 for full quote) — 54% of agent-generated findings were validated by human security engineers in shadow deployment before being surfaced to developers. Framed by the authors as demonstrating "practical utility while underscoring the difficulty of the task" — i.e., even with an agentic verification step, roughly half of raw findings still get filtered out by a human gate before ever reaching the builder. Useful as a concrete "expect ~50% human-filter rate even with a good verifier" data point.

### Gap noted
No source found gives a single canonical "industry standard" number for max fix-loop iterations before mandatory human escalation (e.g., "3 strikes" as a named convention across vendors). The two most concrete numeric anchors found are Claude Code's hook-based **8-consecutive-blocks** hard stop and its **"after two failed corrections, `/clear` and re-prompt"** heuristic — both first-party Anthropic guidance rather than an industry-wide convention. None of the five commercial review vendors (CodeRabbit, Greptile, Graphite, Ellipsis, Cursor Bugbot) publish an explicit max-iteration or auto-escalate-to-human threshold in the pages fetched; escalation in their public materials is described qualitatively ("developer triages," "senior engineers for high-risk changes") rather than as a hard rule.

---

## Source list (full URLs)

- https://code.claude.com/docs/en/code-review
- https://code.claude.com/docs/en/ultrareview
- https://code.claude.com/docs/en/best-practices
- https://github.com/anthropics/claude-code-security-review
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/built-multi-agent-research-system
- https://docs.coderabbit.ai/ (product docs landing)
- https://www.coderabbit.ai/blog/better-models-dont-solve-a-judgment-bottleneck
- https://www.coderabbit.ai/blog/introducing-coderabbit-security
- https://www.coderabbit.ai/blog/close-the-loop-after-every-merge
- https://www.coderabbit.ai/blog/three-hidden-attention-taxes-agentic-sdlc
- https://www.coderabbit.ai/blog/opus-5-model-review (title/URL only, not fetched in depth)
- https://www.greptile.com/ (product page)
- https://www.greptile.com/blog/greptile-v3-agentic-code-review
- https://www.greptile.com/blog/greptile-v4 (title/URL only, not fetched in depth)
- https://graphite.com/diamond (redirect target of graphite.dev/diamond)
- https://www.ellipsis.dev/
- https://cursor.com/bugbot
- https://www.qodo.ai/blog/intro-quality-coding-workflow/
- https://www.qodo.ai/blog/building-an-adaptive-router-for-code-review-depth/
- https://www.qodo.ai/blog/the-right-depth-for-every-pr-introducing-review-effort-modes/
- https://www.qodo.ai/blog/moving-from-ai-code-review-to-the-outer-sdlc-loop/
- https://www.qodo.ai/blog/configuring-qodo-code-review-for-your-teams-workflows/ (title/URL only, not fetched in depth)
- http://arxiv.org/abs/2402.02172v5 (CodeAgent)
- http://arxiv.org/abs/2601.19138v2 (AgenticSCR)
- http://arxiv.org/abs/2607.05659v1 (Agents with Feelings? Personality and Emotion in Multi-Agent Software Teams)
- http://arxiv.org/abs/2607.24964v1 (ALIBI — adversarial attacks on LLM vulnerability detectors; adjacent/caution reference)

---

# 5. Documentation: librarian / memory / context-wiki patterns

# Research: DOCUMENTER/LIBRARIAN agent patterns for an agentic software factory

Compiled 2026-08-18. Sources are WebFetch results against live pages plus `gh` (GitHub CLI) code/repo
searches, since the session's WebSearch tool-call budget was exhausted almost immediately (before this
task started) and could not be used directly. Bing search-result pages were fetched via WebFetch as a
substitute where noted.

---

## 1. Karpathy's "LLM wiki" / "knowledge base maintained by an LLM" idea

**Verdict: PARTIALLY VERIFIED, MEDIUM CONFIDENCE. Real tweet, but the "wiki" framing and the most-quoted
line come from a third-party interpretive blog, not a directly-fetchable primary source. Do not present
the exact wording as a confirmed Karpathy quote without flagging this.**

### What's well corroborated
Multiple independent searches (via Bing, fetched through WebFetch) consistently return the same tweet:

- **URL:** `https://x.com/karpathy/status/2039805659525644595`
- **Title in search index:** "Andrej Karpathy on X: 'LLM Knowledge Bases — Something I'm finding...'"
- **Date:** April 2, 2026
- **Consistent snippet across multiple independent search queries:** "LLM Knowledge Bases Something I'm
  finding..." / "To convert web articles into .md files I like to use the Obsidian Web Clipper extension,
  and then I also use a hotkey to..."

This snippet — appearing identically across at least three separate search queries — strongly suggests a
real Karpathy tweet exists, titled/opening "LLM Knowledge Bases," describing a personal workflow: using
the **Obsidian Web Clipper** browser extension plus a hotkey to convert web articles into `.md` files,
apparently as the raw material for an LLM-curated personal knowledge base / wiki.

### What could NOT be independently verified
I attempted to fetch the tweet directly via `x.com`, `fxtwitter.com` (redirects to x.com), `vxtwitter.com`,
`nitter.net`, and the `publish.x.com/oembed` API. **All attempts failed** — x.com returned `HTTP 402
Payment Required` (X now paywalls/blocks unauthenticated scraping of tweet content), and the nitter/oembed
mirrors returned empty or unreachable. I could not read the tweet's full verbatim text or thread.

### The specific quote in circulation
A third-party content-marketing blog, **Starmorph** ("How to Build Karpathy's LLM Wiki: The Complete
Guide to AI...", `https://blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide`, published
April 9, 2026 — one week after the tweet), attributes this line to Karpathy:

> "The LLM writes and maintains all of the data of the wiki. I rarely touch it directly."

The Starmorph article claims this comes from the same April 2026 X post (said to have "16+ million views")
and references "his accompanying GitHub Gist that garnered 5,000+ stars." **I could not locate or verify
this gist independently** — searches for it (e.g. `Karpathy gist wiki "ingest" "query" "lint"`) surfaced
only the Starmorph article itself and unrelated Karpathy repos (`karpathy/autoresearch`, `karpathy/nanoGPT`)
that do NOT contain a wiki/knowledge-base pattern.

Per Starmorph's (unverified, secondhand) description, the pattern Karpathy is said to use is a **three-layer
architecture**:
1. `raw/` — immutable source documents, never modified by the LLM (the Obsidian-clipped `.md` files)
2. `wiki/` — LLM-generated markdown organized by type (concepts, entities, sources, comparisons), plus an
   `index.md` (content catalog) and `log.md` (operation log)
3. A `CLAUDE.md`-style schema file defining structure, naming conventions, page templates, and workflows

Three core operations: **ingest** (process new sources), **query** (ask questions), **lint** (health check
for contradictions/orphaned content). Reported scale: ~100 articles, ~400,000 words, grown without Karpathy
writing content directly.

### Why this matters for the report — treat with caution
- The **directly corroborated part** (the tweet exists, titled "LLM Knowledge Bases," about clipping web
  articles to markdown with Obsidian) is about a **personal reading/research knowledge base**, not
  explicitly a software-engineering documentation wiki for a coding-agent pipeline.
- The **"append and review" / "LLM writes, human rarely touches it" framing**, and the entire
  ingest/query/lint/three-layer architecture, is **Starmorph's packaging of the idea**, not a verified
  Karpathy quote or repo. Treat the exact wording as **likely paraphrase/extrapolation**, not verbatim.
- If the report needs an attributable Karpathy quote for a wiki-maintained-by-an-LLM pattern, flag it as
  "attributed to Karpathy in secondary sources; primary tweet could not be independently verified" rather
  than quoting Starmorph's line as Karpathy's own words.

### A related, well-documented misattribution case (useful contrast for the report)
Separately, a viral `CLAUDE.md` "skills file" pattern (about disciplining coding agents — "turns AI coding
agents from overconfident juniors into disciplined engineers") is **also** loosely attributed to Karpathy
in blog coverage, but on closer sourcing this is a clearer case of misattribution-adjacent origin:

- **Source article:** AgentPedia, "Karpathy's CLAUDE.md Skills File: The Complete Guide,"
  `https://agentpedia.codes/blog/karpathy-claude-code-skills-guide` (published April 13, 2026, updated
  July 10, 2026).
- Karpathy's actual January 26, 2026 tweet (`https://twitter.com/karpathy/status/2015883857489522876`,
  quoted by AgentPedia) is a set of **observations about LLM agent failure modes**, not a template or file:
  - "The models make wrong assumptions on your behalf and just run along with them without checking."
  - "They really like to overcomplicate code and APIs, bloat abstractions, don't clean up dead code..."
  - "They still sometimes change/remove comments and code they don't sufficiently understand as side
    effects..."
  - "LLMs are exceptionally good at looping until they meet specific goals... Don't tell it what to do,
    give it success criteria."
  - AgentPedia's own article explicitly notes: **"Karpathy shared observations, not the repo itself.
    Developer Forrest Chang then encoded these observations into the `CLAUDE.md` file, which went
    viral on GitHub — not Karpathy's direct contribution."**

This is a clean, well-sourced example worth citing in the report: **Karpathy is a prolific source of
widely-circulated observations about coding-agent behavior, but specific artifacts/templates/wikis
attributed to him in secondary coverage often turn out to be built by someone else off his tweets** (here,
Forrest Chang). Apply the same caution to the "LLM wiki" claim.

**Recommendation for the report:** cite the "LLM wiki" concept as *"an idea that has circulated under
Karpathy's name since an April 2026 tweet about LLM-curated personal knowledge bases, though the specific
'append-and-review' framing is third-party paraphrase that could not be independently verified against the
primary tweet."* Do not present it as a confirmed, quotable Karpathy proposal without that caveat.

---

## 2. AGENTS.md — the open convention

**Source:** `https://agents.md/` (fetched directly, live page)

### Purpose
> "a simple, open format for guiding coding agents"

Positioned as a complement to README, not a replacement:
> "README.md files are for humans: quick starts, project descriptions, and contribution guidelines."

AGENTS.md instead holds the detailed, agent-specific operational context that would clutter a human-facing
README — build/test commands, code style, security notes, PR conventions.

### Structure
Standard Markdown, flexible headings, **"no required fields"** — teams structure it as needed. Commonly
recommended sections:
- Project overview
- Build and test commands
- Code style guidelines
- Testing instructions
- Security considerations
- Commit message and pull request guidelines

**Monorepo support:** nested AGENTS.md files for subprojects; agents read the nearest file in the directory
tree (same resolution model as CLAUDE.md's directory-walk, see §3).

### Adoption
- **Scale:** "used by over 60k open-source projects" (per the site's own header stat).
- **Tool/platform support (20+):** OpenAI Codex, Google Jules, GitHub Copilot, Cursor, VS Code, Aider,
  Factory, Amp, goose, Devin (Cognition), UiPath, JetBrains Junie, Zed, Warp, and others.
- **Origins:** "AGENTS.md emerged from collaborative efforts across the AI software development ecosystem,
  including OpenAI Codex, Amp, Jules from Google, Cursor, and Factory."
- **Governance:** "AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation" —
  i.e., it has moved from an informal multi-vendor convention to formal, vendor-neutral open-source
  foundation governance.

### Claude Code's relationship to AGENTS.md
Confirmed directly from Anthropic's own docs (§3 below): **Claude Code does not read AGENTS.md natively** —
it only reads `CLAUDE.md`. The documented bridge pattern is either:
```markdown
@AGENTS.md

## Claude Code
Use plan mode for changes under `src/billing/`.
```
or a symlink (`ln -s AGENTS.md CLAUDE.md`), or the `/import` command (Claude Code ≥ v2.1.213), which
"appends a one-time copy of instruction files such as AGENTS.md to the matching CLAUDE.md and carries over
MCP servers, commands, subagents, and skills." `/init` (with `CLAUDE_CODE_NEW_INIT=1`) also reads
`AGENTS.md`, `.devin/rules/`, `.windsurf/rules/`/`.windsurfrules`, and `.clinerules` when generating a new
CLAUDE.md.

**Design implication for a DOCUMENTER agent:** if the factory wants cross-tool portability (in case a
different agent CLI is swapped in later), authoring the primary instruction file as `AGENTS.md` and having
`CLAUDE.md` import it (rather than the reverse) is the pattern Anthropic itself documents and recommends.

---

## 3. CLAUDE.md conventions (docs.claude.com → code.claude.com)

**Source:** `https://code.claude.com/docs/en/memory` (docs.claude.com/en/docs/claude-code/memory redirects
here). Fetched directly, live page, in full.

### Two complementary memory systems
| | CLAUDE.md files | Auto memory |
|---|---|---|
| Who writes it | You (human) | Claude |
| What it contains | Instructions and rules | Learnings and patterns |
| Scope | Project, user, or org | Per repository, shared across worktrees |
| Loaded into | Every session | Every session (first 200 lines or 25KB) |
| Use for | Coding standards, workflows, architecture | Build commands, debugging insights, discovered preferences |

> "Claude treats them as context, not enforced configuration. To block an action regardless of what Claude
> decides, use a PreToolUse hook instead."

### When to add to CLAUDE.md (heuristic given in the docs)
> "Add to it when: Claude makes the same mistake a second time; a code review catches something Claude
> should have known about this codebase; you type the same correction or clarification into chat that you
> typed last session; a new teammate would need the same context to be productive."

Guidance to keep it to durable, every-session facts; multi-step procedures → a **skill**; content relevant
only to part of the codebase → a **path-scoped rule** (`.claude/rules/*.md` with `paths:` frontmatter).

### Memory hierarchy (load order, broadest → most specific; later = higher priority since concatenated in
this order and later content is "read last")
1. **Managed policy** (org-wide, IT-deployed, cannot be excluded by users):
   - macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`
   - Linux/WSL: `/etc/claude-code/CLAUDE.md`
   - Windows: `C:\Program Files\ClaudeCode\CLAUDE.md`
   - Can alternatively be set inline via the `claudeMd` key in `managed-settings.json`.
2. **User instructions:** `~/.claude/CLAUDE.md` — personal preferences, all projects.
3. **Project instructions:** `./CLAUDE.md` or `./.claude/CLAUDE.md` — team-shared, via source control.
4. **Local instructions:** `./CLAUDE.local.md` — personal, project-specific, gitignored.

All discovered files are **concatenated**, not override-replaced. Claude walks up the directory tree from
cwd; ancestor files load in full at launch; CLAUDE.md/CLAUDE.local.md files in subdirectories below cwd
load on demand when Claude reads files there. `.claude/rules/` (no `paths:` frontmatter) load with the same
priority as `.claude/CLAUDE.md`; rules with `paths:` frontmatter load only when Claude touches matching
files.

### Size / structure guidance (directly relevant to a token-efficient wiki design)
> "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce
> adherence." Overflow → path-scoped rules or `@import` (imports still load fully at launch — imports are
> for organization, not for reducing context).

> "**Structure**: use markdown headers and bullets to group related instructions... organized sections are
> easier to follow than dense paragraphs."

> "**Specificity**: write instructions that are concrete enough to verify" — e.g. "Use 2-space indentation"
> not "Format code properly"; "Run `npm test` before committing" not "Test your changes."

`/doctor` can propose trims to a checked-in CLAUDE.md: "it cuts content Claude can derive from the
codebase, such as directory layouts, dependency lists, and architecture overviews, and keeps pitfalls,
rationale, and conventions that differ from tool defaults" (v2.1.206+).

### `@path` imports
`@path/to/file` syntax pulls in additional files (max depth 4 hops, relative paths resolve relative to the
importing file). Backtick-wrapped mentions (`` `@README` ``) are NOT imported. External imports (resolving
outside the working directory, e.g. `@~/.claude/my-project-instructions.md`) trigger a one-time approval
dialog the first time they're encountered in a project.

### `/init` and `/memory`
- **`/init`**: generates a starting CLAUDE.md by analyzing the codebase for build/test commands and
  conventions; if a CLAUDE.md already exists, it suggests improvements instead of overwriting. With
  `CLAUDE_CODE_NEW_INIT=1`, becomes an interactive multi-phase flow: asks which artifacts to set up
  (CLAUDE.md, skills, hooks), explores the codebase via a subagent, asks follow-up questions, and presents
  a reviewable proposal before writing.
- **`/memory`**: lists all CLAUDE.md / CLAUDE.local.md / memory-file locations (including not-yet-existing
  ones), toggles auto memory on/off, opens the auto-memory folder, and opens any file in your editor
  (creating it first if it doesn't exist).
- **`/context`**: shows what actually loaded into the current session — the recommended way to verify a
  CLAUDE.md or memory file is actually being read.

### Auto memory (Claude Code's "memory tool" equivalent — directly answers the "auto-memory" research ask)
Auto memory is **on by default**, toggled via `/memory` (sets `autoMemoryEnabled` in `~/.claude/settings.json`,
or per-project) or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

**Storage:** `~/.claude/projects/<project>/memory/` (one directory per git repo, shared across worktrees;
outside git, keyed on project root). Configurable via `autoMemoryDirectory` setting.

**Structure (this is directly the "index + on-demand" pattern the report is investigating):**
```
~/.claude/projects/<project>/memory/
├── MEMORY.md          # Concise index, loaded into every session
├── debugging.md       # Detailed notes on debugging patterns
├── api-conventions.md # API design decisions
└── ...                # Any other topic files Claude creates
```
> "`MEMORY.md` acts as an index of the memory directory. Claude reads and writes files in this directory
> throughout your session, using `MEMORY.md` to keep track of what's stored where."

**Hard budget enforced automatically:** "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever
comes first, are loaded at the start of every conversation." If Claude's write pushes `MEMORY.md` near the
limit, Claude Code nudges it to shorten (one line per entry, push detail into topic files, merge/drop stale
entries); if it's over the limit, the write still succeeds but an error tells Claude to rewrite the index,
because content past the limit silently doesn't load next time. **Topic files are not loaded at startup —
Claude reads them on demand with normal file tools when needed.** This is Anthropic's own concrete
implementation of "small index + read-on-demand," directly relevant to designing the wiki's INDEX.md.

Auto memory is machine-local (not synced across machines), survives Claude Code's transcript-retention
cleanup sweep, and subagents get their own separate memory directory (main-conversation auto memory isn't
inherited by subagents, except forks).

---

## 4. "Learnings" / "lessons learned" files for coding agents

**This pattern is real, common, and current** — confirmed via live `gh search code` against GitHub (not
secondary blog coverage). A `LESSONS.md`/`lessons.md` file, referenced from `AGENTS.md`/`AGENT.md`/
`CLAUDE.md`, updated after every user correction, is an emergent convention across many independent repos
as of mid-2026. Representative hits (`gh search code "LESSONS.md" agent` and `"lessons.md"`):

- **`unoplatform/uno.toolkit.ui`** and **`unoplatform/uno.extensions`** (`AGENTS.md`):
  > "Domain lessons / postmortems → `specs/lessons.md`."
  > "🚫 **Never** record cross-agent corrections in personal/auto memory (e.g.
  > `~/.claude/projects/<project>/memory/`, `feedback_*.md`, individual user preference files). Personal
  > memory is per-user and not shared via git, so other agents and contributors will not see it and the
  > mistake will repeat. If a correction is general enough that any future agent should follow it, it
  > belongs in a checked-in file. Reserve personal memory for things that are genuinely individual to one
  > user (their role, their preferences) — not project rules."
  This is an explicit, well-articulated **shared vs. personal memory distinction** — directly relevant to
  a DOCUMENTER agent design: project-wide learnings must be git-tracked and checked in, not left in
  per-user auto-memory that other agents/contributors never see.

- **`cytoscape/cytoscape-web`** (`AGENTS.md`):
  > "**Capture Lessons:** After any user corrections or unexpected failures, record what you learned in
  > `.serena/memories/lessons.md` to prevent repeated mistakes. This file is git-tracked and shared across
  > all agents. Review it at the start of each session."

- **`RediCloud/cloud-v2`** (`AGENT.md`) — "Self-Improvement Loop":
  > "After ANY correction from the user: update `tasks/lessons.md` with the pattern. Write rules for
  > yourself that prevent the same mistake. Ruthlessly iterate on these lessons until mistake rate drops.
  > Review lessons at session start for relevant project."
  Also separates `tasks/todo.md` (plan-first, checkable items, review section added after) from
  `tasks/lessons.md` (durable cross-task learnings) — a clean two-file split between ephemeral task
  scratch state and persistent institutional knowledge.

- **`taracodlabs/aiden`** (`AGENTS.md`): "`LESSONS.md` — failure trace, written by the learning-memory
  module"; agent calls `markMemoryDirty()` and "the next turn rebuilds the system [prompt]" — i.e. an
  explicit dirty-flag/rebuild mechanism tying the lessons file into context assembly.

- **`azeemigi/todo-app`** (`AGENT.md`): template-based bootstrapping —
  > "If `.github/analysis/lessons.md` does not exist, create it by copying
  > `.github/analysis/lessons.template.md` into it before proceeding... Read `.github/analysis/lessons.md`
  > before starting non-trivial work, and always when the user flags a repeat issue ('last time', 'you
  > missed'). It is the live log of corrections, pitfalls, and verified facts for this repository."

- **`xflops/flame`** (`AGENTS.md`): distinguishes durable lessons from ephemeral scratch: "Task files under
  `tasks/` are local agent notes. Keep them out of commits and PRs unless the user explicitly asks to
  publish them" — i.e. `tasks/todo.md` may be gitignored/ephemeral while `tasks/lessons.md` is durable.

**Common shape across all these independent repos:** a single append-mostly markdown file (`lessons.md` /
`LESSONS.md`), triggered specifically by **user corrections and unexpected failures/postmortems**, reviewed
at the **start of every session**, checked into git so it's shared across agents/contributors (explicitly
contrasted with Claude Code's per-user, non-git-tracked auto memory), sometimes bootstrapped from a
template file.

### Anthropic's own "multisession software development" pattern (primary source, closely related)
From the memory-tool docs (`platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool`) and the
companion blog post **"Effective harnesses for long-running agents"**
(`https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`):

> "For software projects that span multiple agent sessions, set up memory files deliberately instead of
> writing them ad hoc as work progresses. ... each new session resumes from the state the last one
> recorded."

1. **Initializer session** sets up: a progress log, a feature checklist, and a reference to any
   startup/init script — *before* any substantive work begins.
2. **Subsequent sessions** open by reading those files, restoring state without re-exploring the codebase.
3. **End-of-session update** to the progress log before the session ends.
4. **Key principle:** "Work on one feature at a time. Mark a feature complete only after end-to-end
   verification confirms it works, not when the code is written."

The blog post frames the core problem as agents behaving "like engineers working in shifts, where each new
engineer arrives with no memory of what happened on the previous shift" — solved with an `init.sh` script,
a JSON feature list (explicitly forbidding agents from editing/removing tests to fake completion), a
`claude-progress.txt` file, and git as both a documentation trail and a recovery mechanism (agents are told
to use `git` to revert bad changes and recover known-good states). Failure modes it's designed against:
declaring victory early, leaving broken handoffs, prematurely marking features "passing," and setup
friction between sessions.

**Relevance to DOCUMENTER role:** this is architecturally the same shape as the "lessons.md" convention
above but scoped to a single long task rather than the whole project's institutional memory — the
DOCUMENTER agent's wiki is essentially the project-lifetime version of this per-session progress log.

---

## 5. ADRs (Architecture Decision Records)

### The Nygard template (canonical primary source)
**Source:** `https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions` (Michael Nygard,
2011; fetched directly).

Four core sections, plus a Status field:
1. **Title** — "short noun phrases," e.g. "ADR 1: Deployment on Ruby on Rails 3.0.10"
2. **Status** — "proposed," "accepted," "deprecated," or "superseded"
3. **Context** — "describes the forces at play, including technological, political, social, and project
   local"
4. **Decision** — "describes our response to these forces. It is stated in full sentences, with active
   voice"
5. **Consequences** — "describes the resulting context, after applying the decision. All consequences
   should be listed here"

Rationale, directly relevant to a DOCUMENTER agent's design philosophy:
> "agile methods are not opposed to documentation, only to valueless documentation"
> "One of the hardest things to track during the life of a project is the motivation behind certain
> decisions." Without it, teams face only two poor options — blind acceptance or blind reversal.
> Keep each ADR to "one or two pages long," written as "a conversation with a future developer" —
> **bite-sized, per-decision files beat one large living document because large documents don't get read
> or updated.**

### AI agents writing/consulting ADRs — real, current tooling ecosystem (verified via `gh search repos`)
This is an active space as of August 2026, not speculative. Representative Claude Code plugins/skills
found via direct GitHub search:

- **`zircote-plugins/adr`** — "Claude Code plugin for complete ADR lifecycle management with multi-format
  support (**MADR, Nygard, Y-Statement**), compliance auditing, and configurable workflows"
- **`memvid/adrflow`** — "An MCP server that captures architectural decisions while you code. Works with
  Claude Code, Cursor, Windsurf, and Codex."
- **`zvoque/passive-adr`** — "Passive Architecture Decision Record memory for Claude Code — auto-records
  significant decisions and recalls them in future sessions."
- **`codenamev/ai-software-architect`** — "AI-powered architecture documentation framework with ADRs,
  reviews, and pragmatic mode. Now available as Claude Code Plugin."
- **`caiaffa/claude-code-ultimate-engineering-system`** — "engineering toolkit for Claude Code: premium
  skills, agent workflows, ADR/PRD templates, incident learning, and production-grade governance"
- **`diogoX451/principal-software-architect`** — "Principal software architecture agent skill (Claude Code
  / Grok / Codex) — ADRs, reviews, trade-offs"
- **`study8677/architecture-copilot`** — bilingual (zh/en) skill that "uses continuous deep questioning to
  make you think through architecture before writing code (produces architecture diagrams / ADR / roadmap)"

Real project CLAUDE.md files also show ADRs wired directly into agent workflow conventions:
- **`MarcusXavierr/cata-centavo`**: `docs/adr/0001-stack-and-architecture.md` is "the source of truth for
  every engineering decision here... When the ADR and this file [CLAUDE.md] disagree, the ADR wins."
- **`bertiniteam/b2`**: cites specific numbered ADRs as the fix record for a subtle bug, including one ADR
  documenting a **reversed** earlier decision (`0003-manylinux-no-full-pytest.md`, "the (now reversed)
  smoke-test stopgap and its history") — i.e., ADRs actively used to prevent agents from re-trying
  previously-rejected fixes.
- **`OCHA-DAP/topo-tools-py`**: keeps an explicit decision tree in `docs/adr/README.md` for "how to decide
  ADR vs. `docs/explanation/` vs. CLAUDE.md's Key Patterns" — a directly reusable pattern for a
  DOCUMENTER agent that needs to route new knowledge to the right artifact type.
- **`globbestael/DedupEndNote`** (CLAUDE.md) uses a simple routing table: commands/coding rules/test
  structure/config → CLAUDE.md; "Architecture decisions (why X, rejected alternatives)" → `docs/adr/`.

**Takeaway for the report:** ADRs have become a standard "why" ledger that agent CLAUDE.md/AGENTS.md files
explicitly point to and defer to, with a maturing plugin ecosystem (auto-capture, multi-format support,
compliance auditing) treating ADR authorship as something an agent does semi-autonomously, subject to
human review — same append-mostly, human-curated shape as the lessons.md pattern.

---

## 6. Changelogs — Keep a Changelog format

**Source:** `https://keepachangelog.com/en/1.1.0/` (fetched directly).

Core definition:
> "A changelog is a file which contains a curated, chronologically ordered list of notable changes for
> each version of a project."

Guiding principles (verbatim):
- "Changelogs are *for humans*, not machines."
- "There should be an entry for every single version."
- "The same types of changes should be grouped."
- "Versions and sections should be linkable."
- "The latest version comes first."
- "The release date of each version is displayed."

Six standard categories: **Added** (new features), **Changed** (changes in existing functionality),
**Deprecated** (soon-to-be-removed features), **Removed** (now-removed features), **Fixed** (bug fixes),
**Security** (vulnerabilities).

Best practices: maintain an `Unreleased` section at the top for pending changes ahead of the next release;
use ISO 8601 dates (YYYY-MM-DD) — "doesn't overlap in ambiguous ways with other date formats, unlike some
regional formats that switch the position of month and day numbers."

Explicit anti-pattern: don't substitute raw commit logs for a changelog — "they're full of noise" (merge
commits, doc-only commits, etc.); a changelog should surface only what's meaningful to a consumer of the
project.

**Relevance to a DOCUMENTER agent:** this is a good template for an agent that already sees every merged
change — it can mechanically classify a diff/PR into one of the six categories and append a curated,
human-readable line to `Unreleased`, then the human (or a release step) stamps the version/date on release.
This is a much lower-judgment task than lessons.md or ADR authorship, since the categorization is close to
mechanical.

---

## 7. Keeping a context wiki accurate and small — the index + on-demand pattern vs. RAG

### Anthropic's "Effective context engineering for AI agents" (primary source, most directly relevant to
this design question)
**Source:** `https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents`
(September 29, 2025 — fetched via search-result reconstruction; content cross-checked against the memory
tool docs, which cite and summarize the same post).

**Core framing:** "Context is a critical but finite resource for AI agents."

**"Just in time" retrieval vs. pre-loading (this is the index + on-demand pattern, described explicitly):**
> "Rather than pre-processing all relevant data up front, agents built with the 'just in time' approach
> maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references
> to dynamically load data into context at runtime using tools."
This is explicitly analogized to human cognition — people don't memorize everything, they use file systems
and bookmarks and retrieve on demand. **Trade-off acknowledged directly:** runtime exploration is slower
than pre-computed retrieval, but reduces context pollution and avoids stale-index problems.

**Filesystem/agentic-search vs. embeddings-based RAG:**
> "Today, many AI-native applications employ some form of embedding-based pre-inference time retrieval...
> As the field transitions to more agentic approaches, we increasingly see teams augmenting these
> retrieval systems with 'just in time' context strategies."
Claude Code is cited as the exemplar: it leans on file metadata (folder hierarchy, naming conventions,
timestamps) as retrieval signals rather than relying purely on vector similarity, and uses tools like
`head`/`tail`/`grep`/`glob` to inspect data without loading whole files into context — "bypasses the
issues of stale indexing and complex syntax trees" that vector/RAG indexes can suffer from as a codebase
changes.

**Structured note-taking / agentic memory (for long-horizon tasks):**
> "Structured note-taking, or agentic memory, is a technique where the agent regularly writes notes
> persisted to memory outside of the context window."
Cited example: "Claude Playing Pokémon" tracked "for the last 1,234 steps I've been training my Pokémon in
Route 1, Pikachu has gained 8 levels toward the target of 10" across thousands of steps, reading its own
notes back after context resets to continue multi-hour sequences.

**Sub-agent architectures for context isolation:**
> "Rather than one agent attempting to maintain state across an entire project, specialized sub-agents can
> handle focused tasks with clean context windows."
Each sub-agent explores extensively in its own window but returns only a condensed summary (~1,000–2,000
tokens) to the orchestrating agent — "clear separation of concerns."

**Explicit small-knowledge-base-vs-RAG threshold, from Anthropic's separate Contextual Retrieval post**
(`https://www.anthropic.com/news/contextual-retrieval`):
> "if your knowledge base is smaller than 200,000 tokens (about 500 pages of material), you can just
> include the entire knowledge base in the prompt" using prompt caching. "However, as your knowledge base
> grows, you'll need a more scalable solution." (That post's actual subject — contextual embeddings +
> contextual BM25 for chunk retrieval, cutting retrieval failure by 35–49%, 67% with reranking — is a
> generic RAG-improvement technique less directly applicable to a small, actively-curated engineering
> wiki than the "just in time" pattern above, but the 200K-token threshold is a useful concrete rule of
> thumb for "when do I even need retrieval vs. just loading everything.")

### Claude Code's own concrete implementation of "small index + on-demand files" (see §3 for full detail)
Auto memory's `MEMORY.md` (hard-capped at 200 lines / 25KB, auto-enforced with a rewrite-nudge/error loop)
acting as an index into uncapped topic files that are read on demand — this is Anthropic's own production
answer to exactly the trade-off the report is investigating, and is probably the single most directly
reusable reference design for a DOCUMENTER/LIBRARIAN agent's wiki: **one small, hard-budgeted index file
the orchestrator always loads, pointing to topic files it only reads when relevant.**

### Synthesis for the report
Three converging, mutually-reinforcing pieces of guidance from Anthropic across the memory-tool docs, the
context-engineering blog post, and the contextual-retrieval post, plus corroborating field evidence from
GitHub (`docs/adr/README.md` routing tables, CLAUDE.md size caps observed in the wild):
1. **Prefer index + on-demand file reads over RAG/vector search** for anything that fits the "agentic
   filesystem search" regime — i.e., most engineering wikis, which are small (hundreds of KB to low
   single-digit MB of markdown), structured, and benefit from exact/recent information over
   semantic-similarity retrieval. RAG's chunking inherently strips context and risks staleness; agentic
   file exploration with tools like grep/glob avoids both at the cost of being slower per-lookup.
2. **RAG/embeddings only pay off once the corpus exceeds what fits in a cache-friendly prompt** — Anthropic's
   own stated threshold is ~200K tokens (~500 pages); below that, just load it all (with prompt caching).
   A well-curated engineering wiki should stay well under this for a long time if actively pruned.
3. **Enforce a hard, automatically-checked size budget on the index file itself** (Claude Code's own
   `MEMORY.md`: 200 lines / 25KB) rather than relying on discipline alone — with an explicit
   nudge-then-error mechanism when the DOCUMENTER agent's own writes threaten to blow the budget, and
   explicit instructions to push detail into per-topic files instead of growing the index.

---


# PART B — DELIVERABLES

Synthesized from the research above. Every element below is traceable to a specific source in Part A; none of it is invented from scratch. Adapt freely — these are starting points, not gospel.

---

## 6. Suggested design-doc template

Synthesis of: AI Hero's `to-spec` template + the `AGENT-BRIEF.md` durability principles (§1), spec-kit's `spec-template.md` + EARS acceptance criteria (§2), Google's design-doc structure and its "do you need one" test (§2), BMAD's PRD cross-referenced IDs and counter-metrics (§2), Rust RFC's Guide/Reference split (§2).

Two tiers, chosen by the triage heuristic immediately below — don't force every ticket through the full template.

### 6.0 Triage: does this ticket need a design doc at all?

Borrowing Google's "3-of-5" test (§2) and BMAD's "small changes go straight to build" instinct (§2), and Claude Code's own "if you could describe the diff in one sentence, skip the plan" heuristic (§3):

Write a **full design doc** if 2+ are true:
- The implementation approach is genuinely uncertain (more than one reasonable architecture).
- The change touches more than one module/file that don't obviously compose.
- Getting it wrong is expensive to reverse (schema/API/data-model changes, anything "hard to reverse" per the ADR test in §1).
- The acceptance criteria aren't obvious from the ticket title alone.

Otherwise, write a **mini design doc** (the same template, but Problem/Solution/Acceptance-Criteria only, 1 paragraph each) or, for truly trivial work, skip straight to a one-line ticket and let BUILDER decide-and-log per §9.

### 6.1 Template

```markdown
# Design: <Feature/Ticket Name>

**Status:** draft / ready-for-development / in-review / done
**Ticket:** <link>
**Author (Planner session):** <date>

## Problem Statement
The problem, from the user's perspective — not the solution. (AI Hero `to-spec`, §1)

## Goals
What this change must achieve. Bulleted, testable where possible.

## Non-Goals
Reasonable adjacent things this explicitly does NOT do — not just negated goals, but
possibilities deliberately excluded. (Google design docs, §2)

## User Stories / Scenarios
Numbered, extensive. Format: "As a <actor>, I want <feature>, so that <benefit>."
Each story independently testable/demonstrable where the work is large enough to slice
(spec-kit priority slices P1/P2/P3, §2).

## Proposed Design
Overview first, then detail: system-context diagram/data flow if non-trivial, interfaces
and key types (NOT full code), error handling, sequencing. Prefer the project's existing
domain vocabulary (CONTEXT.md, §5) — flag any new terms that need adding to the glossary.

## Alternatives Considered
Rejected options and the trade-offs that led to the decision. (Google + Rust RFC, §2) —
skip this section only for genuinely trivial changes.

## Acceptance Criteria
Testable, EARS-flavored where it clarifies behavior (Kiro, §2):
- `WHEN <trigger>, THE <system> SHALL <response>` (nominal)
- `IF <error condition>, THEN THE <system> SHALL <response>` (error — never WHEN for errors)
- `WHILE <state>, THE <system> SHALL <response>` (state-driven)
Each criterion independently verifiable — no "works correctly."

## Test Plan
What seams will be tested (pre-agree seams before implementation — TDD skill, §1/§3),
what's out of scope for testing, prior art for similar tests in the codebase.

## Risks / Open Questions
Anything still uncertain. If genuinely blocking, this ticket isn't ready-for-development yet —
route back through grilling (§1) or a `to-questionnaire` for an external stakeholder (§1).

## Out of Scope
Explicit boundary — prevents BUILDER gold-plating or scope creep. (AGENT-BRIEF.md, §1)

## Notes for Builder
- Interfaces/behavioral contracts to look for — described by NAME and SHAPE, never by file
  path or line number, since the codebase will have moved by the time this is picked up.
  (AGENT-BRIEF.md durability principle, §1)
- Behavioral, not procedural: describe WHAT the system should do, not HOW to implement it.
- Any decisions explicitly deferred to Builder's judgment, with a note on how to decide
  (see §9's decide-and-log heuristic).
```

**Key borrowed disciplines, worth calling out explicitly:**
- **Never reference file paths or line numbers** in the doc (AI Hero `to-spec`/`to-tickets`/`AGENT-BRIEF.md`, all independently converge on this, §1) — the doc may sit for days before a Builder picks it up.
- **`[NEEDS CLARIFICATION: ...]` markers** instead of silently guessing (spec-kit, §2) — anything marked this way blocks the doc from moving to "ready for development" until resolved by grilling.
- **Counter-metrics** ("what NOT to optimize," BMAD, §2) are worth a line in Goals for anything with a success metric, to stop the Builder or Reviewer from gaming a target.

---

## 7. Suggested PLANNER skill outline (three perspectives)

Synthesis of: AI Hero's `grilling` primitive — frontier/rounds/recommended-answers mechanic (§1), BMAD's named persona agents + `party-mode` debate (§2), spec-kit's `/clarify` question-budget-and-taxonomy discipline (§2), Amazon's "senior person speaks last" anti-anchoring ritual (§2), Claude Code's `AskUserQuestion` interview pattern (§3).

### Stage 0 — Triage (does this need grilling at all?)
Apply §6.0's checklist. If the ticket is trivial, skip straight to a one-line ticket; tell the user why.

### Stage 1 — Fact-finding (agent's job, not the user's)
Before asking the user anything, dispatch a sub-agent to explore the codebase/repo docs (CONTEXT.md, ADRs, existing similar features) and pre-fill anything answerable from the environment. Per the `grilling` rule: "Finding facts is your job, never the user's" (§1).

### Stage 2 — The grilling loop (single-perspective, general)
Run the AI Hero `grilling` mechanic verbatim (§1):
1. Map the request as a design tree — every decision branches into dependent decisions.
2. Compute the **frontier**: every question whose prerequisites are already settled.
3. Ask the whole frontier in one numbered round, each question formatted:
   `❓ **Q1** - **<title>**: <body>` then `➡️ <your recommended answer>`.
4. Wait for the user's answers. Recompute the frontier. Repeat.
5. Stop only when the frontier is empty AND the user confirms shared understanding.

### Stage 3 — Three-perspective pass (product / engineering / UX)
Once the general frontier is resolved, run a second, narrower pass — this is the piece BMAD's `party-mode` and its named personas make concrete (§2). Stand up three lightweight personas (inline voice is enough for a solo factory; a real sub-agent per persona, à la BMAD's `subagent` mode, is worth it for anything hitting §6.0's "full design doc" bar):

- **Product lens** (BMAD's John, adapted): *"Review the current draft design purely from product value: does every feature map back to a real user story? Is there a non-goal that's actually a goal in disguise? Is the success metric gameable — what's the counter-metric? Flag anything that ships complexity without shipping user value."*
- **Engineering lens** (BMAD's Winston, adapted): *"Review the current draft design purely from engineering risk: is there a simpler architecture that meets the same goals (rule of three before abstraction)? What's genuinely hard to reverse here, and does it deserve an ADR? What existing seam/module should this reuse instead of introducing a new one? Flag anything that under- or over-engineers."*
- **UX lens** (BMAD's Sally, adapted): *"Review the current draft design purely from the user's experience: what does the user see/do at each step, including error and edge-case paths? Is any interaction described only in backend terms with no user-facing behavior specified? Flag anything where 'the API returns an error' hasn't been translated into what the user actually sees."*

Mechanics borrowed from `party-mode` (§2): **let the personas disagree and don't force consensus** — *"They clash, and you don't resolve it... Clean consensus that took no effort is where the party dies."* Surface unresolved disagreements as open questions in the doc (§6's "Risks / Open Questions" section) rather than silently picking a winner. If a disagreement can't be resolved by the personas, throw it back to the user as a fresh grilling round scoped to just that question.

Borrow Amazon's anti-anchoring ritual (§2) if a human collaborator (not just the solo user) is present for this stage: read silently first, give general feedback, then line-by-line critique, with the most senior/最終decision-maker speaking last.

### Stage 4 — Write the doc and move the ticket
Write the design doc per §6's template, resolving every `[NEEDS CLARIFICATION]` marker inline. Apply the domain-modeling discipline (§1/§5) as you go: update `CONTEXT.md` the moment a term is resolved, and offer an ADR only when all three of {hard to reverse, surprising without context, real trade-off} hold (§1/§5). Move the ticket to "Ready for Development" only when the frontier is empty and every `[NEEDS CLARIFICATION]` marker is gone.

### Stopping criteria (explicit, borrowed from §1)
> "The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding."
Success signal to watch for, also borrowed from AI Hero's own framing (§1): *"A session with no pushback from you is a session you didn't need."* If the three-perspective pass produces zero disagreements and zero new questions, that's a signal the ticket may not have needed the full pass — note it for next time.

---

## 8. REVIEWER lens list with per-lens prompts

Synthesis of: AI Hero `code-review`'s two-axis parallel-subagent structure + Fowler smell baseline (§1), Claude Code's "fleet of specialized agents ... each looking for a different class of issue ... verification step ... deduplicated, ranked by severity" (§4), CodeRabbit's six categories + 5-tier severity + adversarial "challenges and re-reviews" loop (§4), the "adversarial review step" / "second opinion" pattern (§3/§4), and Anthropic's evaluator-optimizer framing (§4).

**Structure:** run every lens as an **independent, isolated sub-agent** that sees only the diff, the design doc, and its own lens's brief — never another lens's findings and never the implementer's reasoning trail (this isolation is the single most repeated design principle across every source in §1/§3/§4). Aggregate afterward; do not let one lens's findings bias another's. Each lens ends with a verification/refutation pass before its findings are reported (§3/§4's "verification step checks candidates against actual code behavior").

### 8.1 Correctness / Spec-fidelity lens
*"Compare the diff against the design doc's Acceptance Criteria and User Stories, line by line. Report: (a) acceptance criteria that are missing or only partially implemented; (b) behavior in the diff that wasn't asked for (scope creep); (c) criteria that look implemented but where the implementation looks wrong given the stated behavior. Quote the design-doc line for each finding. Do not flag style — that's a different lens's job. Under 400 words."* (Direct adaptation of AI Hero's Spec sub-agent brief, §1.)

### 8.2 Security lens
*"Review the diff for injection (SQL/command/XSS/deserialization), authZ/authN flaws, secret/PII exposure or logging, crypto weaknesses, insecure config/CORS, and supply-chain risk introduced by new dependencies. For each candidate finding, trace the attacker-controlled input from entry point to the vulnerable sink before reporting it — if you can't trace a concrete path, say so explicitly rather than reporting a maybe. Skip low-impact classes (rate limiting, generic input validation without proven impact) unless the design doc calls them out as in-scope."* (Synthesis of Claude Code's `security-review` categories and CodeRabbit's Map→Hunt→Verify security pipeline, §4.)

### 8.3 Performance lens
*"Review the diff for algorithmic complexity regressions, N+1 patterns, unnecessary re-computation or re-fetching, and resource leaks (connections, listeners, memory). Only flag something if you can name the concrete trigger condition (data size, request rate, loop bound) under which it becomes a real problem — a theoretical inefficiency with no realistic trigger is not a finding."*

### 8.4 Test-coverage / test-quality lens
*"Check that every acceptance criterion in the design doc has a corresponding test, and that new tests exercise behavior through the module's public interface rather than internals. Flag the TDD anti-patterns: implementation-coupled tests (would break on refactor without behavior changing), tautological tests (expected value computed the same way the code computes it), and horizontal-slice test additions (bulk tests added after the fact verifying imagined rather than demonstrated behavior)."* (Direct application of AI Hero `tdd`'s anti-pattern list, §1.)

### 8.5 Maintainability / Standards lens
*"Check the diff against this repo's documented coding standards (CONTRIBUTING.md, CODING_STANDARDS.md, CLAUDE.md/AGENTS.md) first — a documented standard always overrides what follows. Then check the diff against this fixed smell baseline, treating each as a judgement call, never a hard violation: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest. Skip anything tooling already enforces (lint/format). Cite the standard or name the smell and quote the hunk for each finding."* (Verbatim structure from AI Hero `code-review`'s Standards sub-agent + Fowler baseline, §1.)

### 8.6 UX lens (when the change is user-facing)
*"Walk through the diff from the end user's perspective: what do they see and do at each step, including error and loading states? Flag any place where the design doc's UX intent isn't reflected in the actual behavior (a backend error that never becomes a user-facing message, a state the UI doesn't visibly represent). Skip this lens entirely for changes with no user-facing surface."* (Adapted from the Planner's UX-persona brief in §7, reused at review time as a cheap way to catch drift between the design's UX intent and the shipped behavior.)

### 8.7 Aggregation and adversarial verification
1. Collect all lens reports **side by side, unmerged** — "reporting them separately stops one axis from masking the other" (§1).
2. Run a **refutation pass**: a fresh sub-agent, given only the diff and one lens's raw findings (no rationale from the finding-agent), tries to disprove each one — reproduce it, or explain why it doesn't hold. This is the "second opinion... a fresh model tries to refute the result" pattern (§3) and CodeRabbit's Verify stage (§4). Drop or downgrade findings that don't survive refutation; keep the epistemic-honesty principle from CodeRabbit: *"when the evidence doesn't support a conclusion either way, say so rather than treating incomplete analysis as proof"* (§4).
3. Assign severity per lens using a shared scale (borrow Claude Code's three-tier 🔴 Important / 🟡 Nit / 🟣 Pre-existing, §4, or CodeRabbit's five-tier Critical/Major/Minor/Trivial/Info if finer granularity is wanted).
4. Report a one-line tally per lens (e.g. "correctness: 1 important, 2 nits; security: 0; ...") plus the worst finding **within** each lens — never a single cross-lens ranking (§1's "don't rerank across axes").

---

## 9. BUILDER definition-of-done checklist

Synthesis of: AI Hero `implement` (§1), Claude Code's verification-loop principle and gate ladder (§3), the "adversarial review step" pattern (§3), worktree isolation mechanics (§3), and the ambiguity-handling synthesis (§3).

A ticket may move from "In Progress" to "In Review" only when **all** of the following are true:

- [ ] **Pre-agreed seams.** Before writing any test, the seams under test were confirmed against the design doc — no test written at an unconfirmed seam (AI Hero `tdd`, §1).
- [ ] **Red before green.** For each vertical slice: failing test written first (confirmed it fails for the right reason, not a broken harness), then only enough code to pass it. No horizontal batch-writing of tests. (§1, §3)
- [ ] **Every acceptance criterion has a test**, traceable back to a specific line in the design doc.
- [ ] **Full check suite is green**: typecheck + full test suite + build + lint, run at least once at the end, not just the touched files (AI Hero `implement`, §1).
- [ ] **Isolation held.** Work happened in its own worktree/branch; nothing outside the ticket's declared scope was touched (§3's four enforced worktree checks, or the human equivalent of that discipline).
- [ ] **Self-review pass completed**, in a fresh sub-agent context that sees only the diff and the design doc — not the implementer's reasoning — checking "every requirement implemented, listed edge cases have tests, nothing outside scope changed" (§3). Findings triaged: only correctness/requirement gaps get fixed; style preferences are logged as optional, not chased (§3's over-fixing warning).
- [ ] **Evidence attached, not asserted.** The handoff includes the actual command + output for build/lint/test, or a screenshot for UI changes — "reviewing evidence is faster than re-running the verification yourself" (§3).
- [ ] **Deviations and resolved ambiguities are logged**, not silently absorbed. Rule of thumb (§3): resolve locally and log when the choice is reversible, one-sentence-describable, and doesn't touch a hard constraint from the design doc; escalate/stop when it changes the implementation approach, or after 2 failed self-corrections on the same point, or when it would expand scope beyond the ticket.
- [ ] **Commit hygiene.** Small, logically-scoped commits; descriptive messages; a `Co-Authored-By:` trailer identifying the agent (§3).
- [ ] **Handoff note written** (~1,000-2,000 tokens, not a transcript dump) to the ticket, containing: what was implemented and where; verification evidence; deviations from the design doc and why; ambiguities resolved locally with rationale; explicitly open questions left for REVIEWER or a human (§3's synthesis of structured note-taking + sub-agent condensation).
- [ ] **Ticket moved to "In Review" only after every box above is checked** — this is the Builder's own gate before the Reviewer's gate, not a substitute for it.

**Enforcement note:** where possible, back these checks with a deterministic **Stop hook** rather than relying on the agent choosing to run them — "hooks are deterministic and guarantee the action happens... CLAUDE.md instructions are advisory" (§3). Keep a hard circuit-breaker on any such gate (Claude Code's own hooks override after 8 consecutive blocks, §3/§4) so a mis-specified check can't loop the agent forever.

---

## 10. LIBRARIAN workflow

Synthesis of: AI Hero `domain-modeling` (CONTEXT.md/ADR discipline, §1/§5), the `lessons.md` convention observed across independent repos (§5), Claude Code's auto-memory `MEMORY.md` index+on-demand design (§5), Keep a Changelog (§5), AGENTS.md/CLAUDE.md conventions and the observed doc-routing tables (§5), and the "index + on-demand file reads over RAG for a small, actively-curated wiki" synthesis (§5).

### 10.1 What the wiki is made of (four artifact types, each with a distinct trigger)

| Artifact | Triggered by | Written when | Git-tracked? |
|---|---|---|---|
| `CONTEXT.md` (+ `CONTEXT-MAP.md` for multi-context repos) | A term is used ambiguously, or conflicts with the existing glossary | Immediately, inline, the moment a term is resolved — never batched (§1) | Yes |
| `docs/adr/NNNN-slug.md` | A decision is hard to reverse **and** surprising without context **and** the result of a real trade-off — all three, or skip it (§1/§5) | At the moment the decision is made, by whichever agent made it (Planner during grilling, Builder if it made an unplanned architectural call) | Yes |
| `lessons.md` (or `LESSONS.md`) | A user correction, an unexpected failure, or a Reviewer finding that reveals a repeatable mistake | Appended at the point of correction; reviewed by every agent at session start (§5) | Yes — explicitly **not** the same as Claude Code's personal/per-user auto memory, which other agents/contributors never see (§5) |
| `CHANGELOG.md` | Any merged, user-visible change | Mechanically classified into Added/Changed/Deprecated/Removed/Fixed/Security under an `Unreleased` heading as part of the Documenter's per-ticket pass (§5) | Yes |

### 10.2 The index (keep the wiki small enough to load as context)

Maintain one small **index file** (`CLAUDE.md`'s `## Agent skills`/knowledge section, or a dedicated `docs/agents/INDEX.md`) that every agent loads every session, capped hard — borrow Claude Code's own auto-memory budget as a concrete number: **~200 lines / 25KB** (§5). The index does two things only: names what exists and where, and gists the one-line takeaway per entry — it never inlines the actual content. Everything else (the full `CONTEXT.md`, individual ADRs, `lessons.md`, `CHANGELOG.md`) is read **on demand** by the agent that needs it, the same "just in time" pattern Anthropic documents for its own agents (§5): *"agents... maintain lightweight identifiers... and use these references to dynamically load data into context at runtime."*

Concrete routing table for the Librarian to maintain (adapted from real-world CLAUDE.md routing patterns found in §5):

```
Commands, coding rules, test conventions, repo etiquette  -> CLAUDE.md / AGENTS.md
"Why" behind a hard-to-reverse decision, rejected alts     -> docs/adr/
Domain terms, ubiquitous language                          -> CONTEXT.md
Repeated mistakes, corrections, postmortem findings         -> lessons.md
User-visible changes, release notes                        -> CHANGELOG.md
```

Do not use vector/RAG search for this wiki. Per Anthropic's own stated threshold (§5), a corpus under ~200K tokens (~500 pages) can simply be read on demand with agentic file tools (grep/glob/read) — cheaper, fresher, and immune to embedding staleness. Reach for retrieval only if the wiki genuinely outgrows that.

### 10.3 The Librarian's per-ticket loop
After REVIEWER moves a ticket to "Done":
1. **Read the ticket's full trail** — design doc, handoff notes, review findings, resolution.
2. **Classify and route** each durable fact using the table above. Most tickets touch 0-2 artifacts, not all four — most work generates a changelog line and nothing else.
3. **Update `CONTEXT.md` inline** if any new or sharpened term surfaced during the work that wasn't already caught by the Planner.
4. **Write an ADR** only if the three-part test (§1) is met and no ADR from the Planner already covers it.
5. **Append to `lessons.md`** anything a future agent would otherwise repeat — a Reviewer finding that reveals a systemic gap, a self-correction the Builder made more than once, a wrong assumption the Planner's grilling didn't catch.
6. **Append a changelog line** under `Unreleased`, correctly categorized.
7. **Prune the index** if it's approaching its size budget: push detail into topic files, merge or drop stale entries, and — borrowing the pruning discipline from AI Hero's `writing-for-agents` (§1) — hunt for **no-ops** (instructions the agent already follows by default) and **staleness** (facts the environment itself now answers, e.g. a convention now enforced by a linter) and delete them rather than let them sediment.
8. **Never write to personal/per-agent memory for anything another agent needs** — if it's project-wide, it goes in a git-tracked file (§5's explicit shared-vs-personal-memory distinction).

### 10.4 Karpathy "LLM wiki" caveat
The oft-cited idea that Andrej Karpathy proposed an "LLM-maintained wiki" the human rarely touches directly could only be **partially verified** (§5): a real April 2026 tweet titled "LLM Knowledge Bases" exists (about clipping web articles via Obsidian), but the specific "the LLM writes and maintains all of the data of the wiki, I rarely touch it directly" quote and the ingest/query/lint three-layer architecture trace only to a third-party blog's paraphrase, not a verified primary source. Treat the framing as a useful design pattern to borrow, not as an attributable Karpathy quote — and note the structurally similar case of the viral `CLAUDE.md` "skills file," which is genuinely misattributed to Karpathy in circulation (it was built by developer Forrest Chang off Karpathy's tweeted observations, per §5's sourcing) — a good cautionary parallel for how these attributions drift.
