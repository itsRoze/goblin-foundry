# /wayfinder (Matt Pocock) — latent.space write-up, aihero docs, skillselion map

- **URL:** https://www.latent.space/p/wayfinder-skill ; https://www.aihero.dev/skills-wayfinder ; https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md ; https://skillselion.com/guides/matt-pocock-skills-map
- **Type:** skills/agents (single skill deep-dive + ecosystem map)
- **Author/Org:** Matt Pocock; interview by Richard MacManus (Latent.Space, 2026-08-20); map by Skillselion (updated 2026-08-16)
- **Researched:** 2026-08-26
- **Status/maturity:** Shipped in mattpocock/skills v1.1 (2026-07-08) as the headliner; user-invoked (`disable-model-invocation: true`); ~12k-char SKILL.md; requires a tracker with native blocking (GitHub sub-issues, GitLab, Linear) or falls back to local Markdown.

## One-paragraph summary

Wayfinder is multi-session *planning* for work "wrapped in fog": it creates a single tracker issue labelled `wayfinder:map` (Destination / Notes / Decisions so far / Not yet specified / Out of scope) whose child issues are **decision tickets** typed `wayfinder:grilling` (HITL, default), `wayfinder:prototype` (HITL), `wayfinder:research` (AFK, parallel subagents on `research/<name>` branches), or `wayfinder:task` (manual unblocking work). Blocking edges use the tracker's native dependency links so the **frontier** (open, unblocked, unclaimed) is visible in the tracker UI; a session claims exactly one ticket by assignment, resolves it, posts a resolution comment, closes it, appends one line to Decisions so far, graduates newly-sharp fog into tickets, and stops. It "plans, it does not do"; when the map is clear it hands off to `/to-spec` → `/to-tickets` → `/implement`. The interview's thesis is that skills work when the author invents precise **leading words** (map, ticket, session, frontier, fog of war, destination) that the agent can hold consistently.

## Core ideas / thesis

- **Session count, not project size, decides the tool.** One session → `grill-me`/`grill-with-docs`; multiple sessions and visible fog → wayfinder. "It's just a more organized and foolproof grill-me."
- **Fog of war**: chart only what you can state precisely now; "Fog or ticket? The test is whether you can state the question precisely now, not whether you can answer it now."
- **The map is an index, not a store**: a decision lives in exactly one ticket; the map gists and links.
- **Tracker as UI**: native blocking renders the frontier visually, so the human sees what's takeable without reading the map.
- **HITL vs AFK is a property of the ticket type**; "a grilling agent that answers its own questions has broken this."
- **Leading words / ubiquitous language** across all skills (Pocock's "AI coding dictionary") so assumptions align between human and agent.

## Architecture & mechanics

### Map body (verbatim skeleton)
```markdown
## Destination
<what reaching the end of this map looks like; one or two lines>
## Notes
<domain; skills every session should consult; standing preferences>
## Decisions so far
- [<closed ticket title>](link): <one-line gist>
## Not yet specified
<!-- fog: in-scope but not sharp enough to ticket -->
## Out of scope
<!-- ruled beyond the destination; never graduates -->
```
Tickets: child issues, body `## Question`, label `wayfinder:<type>`, sized to "one 100K token agent session". Claim = assignee. Answer = resolution comment + close; assets linked, never pasted. Names, not ids, in all human-facing text.

### Two invocation modes
**Chart**: (1) grilling + domain-modeling to name the destination; (2) breadth-first grill for the frontier; if no fog, stop and downsize; (3) create map; (4) create tickets then wire blocking in a second pass (ids first); (5) fire research subagents in parallel; (6) stop.
**Work**: load map low-res → pick user's ticket or first frontier ticket → claim → resolve (zoom into related tickets on demand; call skills named in Notes; default grilling + domain-modeling) → record (comment, close, Decisions-so-far line) → add/graduate tickets, rule out of scope, update invalidated parts. Never more than one ticket per session except research.

### Tracker wiring
`/setup-matt-pocock-skills` writes `docs/agents/issue-tracker.md` with a "Wayfinding operations" section per tracker (GitHub via `gh` sub-issues, GitLab via `glab`, local `.scratch/<feature>/issues/NN-slug.md`). Without native blocking, blockers are inferred from map text (degraded).

### Known failure modes (aihero docs)
- Agents writing production code in wayfinder sessions (most reported); mitigate by separate implementation sessions and by scrutinizing `task` tickets that look like build slices.
- **Balloon maps** (waterfall trap: later tickets invalidate earlier decisions) → scope maps to bounded epics, prototype aggressively.
- Grilling verbosity / decision exhaustion → lower reasoning effort, plain-language instructions in global CLAUDE.md.
- Wrong decisions mid-map: no official flow; tell wayfinder what changed and it updates tickets/comments.

### Skillselion map of the ecosystem (v1.1, as of 2026-08-16)
Intended flow: `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` → `/code-review`, with `/wayfinder` above it for multi-session work and `/research`, `/prototype` feeding it. Prereq: `/setup-matt-pocock-skills` once per repo ("works with literally anything you can connect to programmatically"). Deprecations: `/to-prd`→`/to-spec`, `/to-issues`→`/to-tickets` (v1.1, 2026-07-08); `/diagnose`→`/diagnosing-bugs` (v1, 2026-06-17, now model-invocable); `/zoom-out` deleted into `/improve-codebase-architecture`; `/qa`, `/design-an-interface`, `/request-refactor-plan`, `/ubiquitous-language` (→`/domain-modeling`) retired pre-v1. v1 split user-/model-invocable skills for a claimed "63% reduction in token cost for skill descriptions". `/teach` is productivity, outside the pipeline. Stats: ~160k stars / 7.5M downloads as of July; `grill-me` ~508k installs then (978k 8-week now).

## Workflow: end to end

Idea too big for one session → `/wayfinder "<loose idea>"` (chart) → human works frontier tickets one per session (`/wayfinder <map url>`), research tickets resolve AFK in parallel → map clears (`Not yet specified` empty, all tickets closed) → `/to-spec` in a fresh session → `/to-tickets` → per-ticket `/implement` + `/code-review` (or beta `/implement-spec` AFK) → PR.

## Notable techniques worth stealing

- **Decision tickets vs build tickets as distinct labelled types**, with HITL/AFK as a ticket property. The factory's intake queue should carry this: `research`/`task` are automatable, `grilling`/`prototype` require a human slot.
- **Frontier = open ∧ unblocked ∧ unclaimed, computed from native tracker links**; claim-by-assignee as the concurrency lock. Same primitive as `implement-spec`'s task graph; reuse one frontier query for planning and execution lanes.
- **Map as low-resolution index loaded once per session, zoom on demand**: a concrete progressive-disclosure pattern for long-running projects that maps onto pi's session tree and compaction.
- **"Create then wire" two-pass issue creation** (ids before edges) and **"never resolve more than one ticket per session"** as hard rules for context hygiene.
- **Fog / Not-yet-specified section** as an explicit backlog-of-unknowns, separate from out-of-scope.
- **Refer by name, never by bare id** in human-facing narration.
- **Leading words**: pick a small vocabulary, define it once (Pocock's dictionary), reuse across all skills. Our `CONTEXT.md` should define map/ticket/frontier/lane/gate.
- Research tickets spawning parallel subagents that write cited Markdown on throwaway `research/<name>` branches: cheap AFK parallelism inside a HITL plan.

## Weaknesses / open questions / risks

- Strongly human-in-the-loop; only `research` is AFK. For an unattended factory, wayfinder is the *front door* for humans, not a worker skill.
- Coupled to trackers with native blocking; local-Markdown fallback loses the visual frontier.
- Long prompt (~12k chars) loaded per session; Pocock's own verbosity complaints apply.
- No measurement of outcomes; anecdotes (Pocock's 20-year website rearchitecture) only.
- Volatile naming history; write-ups older than July 2026 reference dead skill names.

## Fit for our agentic stack

- Use wayfinder unchanged (via the mattpocock-skills plugin / `npx skills add`) as the human planning front door in Claude Code; it also loads in pi since it's spec frontmatter + `disable-model-invocation`, but its body says "Call the Skill tool with X" which pi lacks; add a Notes-level instruction (or a pi extension `input` transform) mapping that phrase to `read .agents/skills/<x>/SKILL.md`.
- Make the factory consume the same tracker primitives: `ready-for-agent` tickets from `/to-tickets` and `wayfinder:research` tickets are both AFK-eligible frontier items a pi worker can claim by assignment. One frontier query, two lanes.
- Adopt the map schema for our own epic tracking (Destination / Decisions so far / Not yet specified / Out of scope) in GitHub sub-issues; keep Linear as the "other" prose path.
- Enforce "plans, does not do" mechanically in pi: a `wayfinder` session gets `pi.setActiveTools(["read","grep","find","ls","bash"])` with write tools removed, killing the most-reported failure mode.

## Related resources mentioned

- https://www.aihero.dev/skills — "AI Skills for Real Engineers" hub; per-skill docs `aihero.dev/skills-<name>`; `aihero.dev/ai-coding-dictionary/*` (smart zone, leading words).
- Pocock's YouTube "5 Claude Code skills I use every single day" (2026-07-09) and X posts on v1/v1.1.
- Skillselion research pages: State of AI Agent Skills 2026, Skill Security Census, Skill Clone Census (https://skillselion.com/research).
- research/skills-agents/mattpocock-skills.md (full repo inventory; do not duplicate).

## Key quotes / references

- "It plans, it does not do. Every ticket holds a question whose resolution is a decision, not a slice of a build to execute." (aihero docs)
- "Fog or ticket? The test is whether you can state the question precisely now, not whether you can answer it now." (SKILL.md)
- "Blocking is what renders the frontier visually in the tracker's own UI." (aihero docs)
- "you need to come up with the words for that idea... if you use these very specific, what I call leading words, to lead the agent to understand exactly what each part is... then you've got your skill." (Pocock, Latent.Space)
- "You'll find wayfinder intuitive, I promise. It's just a more organized and foolproof grill-me." (Pocock, X, 2026-07-02)
- "Watch me walk through the essential skills: /grill-with-docs, /to-spec, /to-tickets, /implement, /code-review. It's the whole flow, end-to-end." (Pocock, 2026-07-09)

## Gaps / fetch notes

- Latent.Space piece read via WebFetch summary (paywall-free portion); aihero doc via summary; SKILL.md read to the end of "Work through the map"; skillselion page scraped as text. Pocock's X posts and video not fetched directly.
