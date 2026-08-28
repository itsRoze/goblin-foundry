# pi design philosophy — Mario Zechner & Armin Ronacher posts

- **URLs:** mariozechner.at: `/posts/2025-08-15-mcp-vs-cli/`, `/posts/2025-11-02-what-if-you-dont-need-mcp/`, `/posts/2025-11-30-pi-coding-agent/`, `/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/`, `/posts/2026-04-08-ive-sold-out/`, `/posts/2026-05-30-shitty-robot/` · lucumr.pocoo.org: `/2026/1/31/pi/`, `/2026/2/9/a-language-for-agents/`, `/2026/5/24/pi-oss/`, `/2026/6/23/the-coming-loop/`, `/2026/7/4/better-models-worse-tools/`, `/2026/4/4/absurd-in-production/` · earendil.com/posts: `what-is-a-harness` (08-20), `compaction-in-pi` (08-13), `pi-autoresearch-and-databricks` (08-04), `session-portability` (07-30), `prompt-caching` (07-22), `announcing-pi-and-lefos` (04-08) · Pragmatic Engineer: "Building Pi, and what makes self-modifying software so fascinating"
- **Type:** blog
- **Author/Org:** Mario Zechner (badlogic), Armin Ronacher (mitsuhiko), Earendil
- **Researched:** 2026-08-26
- **Status/maturity:** primary sources from the maintainers; several 2026 posts could only be read via summaries (see Gaps).

## One-paragraph summary

The maintainers' writing converges on a few load-bearing beliefs: the harness's job is to control context and then get out of the way (short system prompt, four tools, everything visible); capability should be added by the agent writing extensions for itself, hot-reloaded and tested on a session branch, rather than by installing MCP servers or sub-agent frameworks; sub-agents are "a black box within a black box" so spawn explicit pi processes you can read; security is not the harness's job; and — from Armin's 2026 posts — the outer "harness loop" (automation deciding when work is done) is coming whether we like it or not, but it produces over-defensive, invariant-poor code, so factories should keep human judgment in the loop and prefer verification that is objective. A late-2026 wrinkle: frontier models are being RL-trained inside Claude Code's forgiving harness, so they hallucinate tool fields on stricter schemas — a harness that differs from Claude Code inherits its quirks.

## Core ideas / thesis (by post)

### Mario Zechner

- **MCP vs CLI (2025-08-15)** — benchmarked: CLI tools with a README the agent reads on demand beat MCP servers that dump tool descriptions into every session. "7–9% of your context window gone before you even start working."
- **What if you don't need MCP at all? (2025-11-02)** — skills = CLI + README; progressive disclosure; `badlogic/agent-tools`.
- **What I learned building an opinionated and minimal coding agent (2025-11-30)** — the founding post. Loop: "the loop just loops until the agent says it's done"; `pi-agent-core` emits events for everything, steering/follow-up queues (sequential or batched). Context engineering: "exactly controlling what goes into the model's context yields better outputs, especially when it's writing code"; other harnesses "inject stuff behind your back that isn't even surfaced in the UI". Sub-agents rejected: "you have zero visibility into what that sub-agent does. It's a black box within a black box" — spawn pi via bash instead; "context gathering is a sign you didn't plan ahead." Security: "full YOLO mode… as soon as your agent can write code and run code, it's pretty much game over" so restrictions give false confidence — sandbox outside.
- **Thoughts on slowing the fuck down (2026-03-25)** — (not readable; referenced in coverage as a pace/maintenance reflection during pi's growth).
- **I've sold out (2026-04-08)** — Earendil deal: "pi is MIT licensed. It will stay MIT licensed… Nothing changes." Repo → `earendil-works/pi`; "No CLA, no DCO"; three tiers (MIT core / Fair Source value-adds with delayed open-sourcing / proprietary enterprise incl. cloud); Mario keeps technical direction with Armin and Colin; "the fork button on GitHub still works. Always will."
- **Pragmatic Engineer interview** — "add as few features as possible to Pi" for behavioural stability (Claude Code's expansion made it unpredictable); "different projects need different harness types … the same hammer is not ideal for every single construction job"; self-modifying software as "a preview of how self-modifiable software might look"; "your biggest enemy is still complexity. it's also your agent's biggest enemy. but it has no holistic view of your code base, so it keeps adding complexity"; human judgment "firmly at the heart".

### Armin Ronacher

- **Pi: The Minimal Agent Within OpenClaw (2026-01-31)** — "shortest system prompt of any agent that I'm aware of and it only has four tools". Core idea: "if you want the agent to do something that it doesn't do yet, you don't go and download an extension… You ask the agent to extend itself." Hot reload loop: "the agent can write code, reload, test it and go in a loop until your extension actually is functional." Tree sessions let the agent fix a broken tool on a side branch without polluting main context. His own extensions: `/answer`, `/todos`, `/review` (review conducted by the agent on a branch of the session). OpenClaw = pi with the UI removed and a chat attached.
- **A Language For Agents (2026-02-09)** — agent-written code should favour explicit syntax, greppability/local reasoning, typed results over exceptions ("agents struggle with exceptions, they are afraid of them"); "the agent does much better with TypeScript" — why pi extensions are TS.
- **Absurd In Production (2026-04-04)** — Earendil's Postgres durable-execution engine in production (candidate factory orchestrator; see pi.md).
- **Building Pi With Pi (2026-05-24)** — dogfooding workflow: `.pi/` slash commands `/is` (investigate a GitHub issue, "independently verify behaviour rather than trust existing analysis"), `prompt-url-widget` (shows issue metadata, renames session), `/wr` (wrap up: changelog, comment, commit, push). Parallelism = several pi windows each running `/is` on a different issue, reviewed sequentially. Lesson: "The correct fix is not to handle the bad state, but to make the bad state impossible" (esp. persisted session data). Complaint: LLM-laundered issues with "plausible but wrong diagnosis". "Open Source needs more collaboration, not more isolated work with a machine."
- **The Coming Loop (2026-06-23)** — distinguishes the inner agent loop from the outer **harness loop** ("the external system deciding when work continues, whether results suffice, or if tasks need recycling"). Autonomous loops yield "code that is too defensive, too complex", patching bad states instead of eliminating them. Works for porting, performance exploration, security research — "temporary artifacts or mechanical transformations where verification is objective". Pi "should prioritize keeping human judgment intact rather than racing toward fully autonomous software" — yet "opting out becomes impossible".
- **Better Models: Worse Tools (2026-07-04)** — Opus 4.8 / Sonnet 5 invent spurious fields (`requireUnique`, `oldText2`) on pi's `edit` tool. "Tool schemas are not neutral, at least not on Anthropic models." Claude Code "filters out unexpected keys and does not use strict mode", rewarding sloppy calls during RL; other harnesses "inherit its quirks."

### Earendil blog (pi-era)

- **What is a Harness? (2026-08-20)** — harness = system prompt + tools + agentic loop + translation layer (multi-provider); pi is "a minimal agent harness designed to get out of the way"; the translation layer is what preserves "human agency" and lets different models do different jobs.
- **Pi, Minimal and Performant (2026-08-04)** — Shopify's `pi-autoresearch` loop; Databricks benchmark (highest pass rate, ~3x less context/turn, >2x cheaper).
- Compaction (08-13), Session portability (07-30), Prompt caching (07-22) — see pi.md; not re-read here.

## Architecture & mechanics (what the posts prescribe)

- Agent loop: single loop until the model stops calling tools; events for everything; steer/follow-up queues.
- Extension loop: agent writes `~/.pi/agent/extensions/x.ts` → `/reload` → test → iterate, on a session branch (`/tree`) so failures don't cost main context.
- Parallelism as practiced by the maintainers: **many independent pi windows/sessions on independent tasks**, human reviews serially — not sub-agent trees.
- Skills as CLI+README; MCP only via adapter if unavoidable.
- Tool schemas: keep them close to Claude Code's shapes for Anthropic models, or tolerate/repair extra fields (pi added leniency after the July issue).

## Workflow: end to end (Armin's pi-on-pi flow, generalised)

1. Open one session per issue with a template command (`/is <url>`) that injects the issue, sets session name, and instructs independent reproduction.
2. Run N such sessions in parallel windows; each is fully inspectable.
3. Review each result serially; fix on a session branch if needed.
4. `/wr` — a wrap-up command that updates changelog, drafts the comment, commits, pushes.

## Notable techniques worth stealing

- Session-named, template-driven task kickoff (`/is`, `/wr`) — our `/implement <ticket>` and `/finish` prompt templates.
- "Verify independently; don't trust the analysis in the ticket" as a system-prompt rule for investigative agents.
- Use the session tree for *tool self-repair* on a side branch → applicable to factory workers that build their own helpers.
- Prefer objective verification (tests, mutation, benchmarks) for anything run in an outer loop; reserve human judgment for design/API changes.
- Typed-result over exceptions and greppable explicit code as coding standards in worker prompts (agents produce better code under them).
- Keep tool schemas Claude-Code-shaped (or normalise extra fields) when using Anthropic models.
- "Make the bad state impossible" as a reviewer rubric — flag defensive patches around persisted data.

## Weaknesses / open questions / risks

- Maintainers are philosophically against exactly what a factory is (opaque autonomous loops); expect core to stay minimal and orchestration to remain third-party or Earendil-commercial ("cloud infrastructure" tier, Lefos).
- "Spawn pi via bash for visibility" scales to a handful of sessions with a human reading them; it is not a fleet design.
- Model/harness co-evolution (Better Models: Worse Tools) means a pi-based factory needs schema-drift monitoring per model release.
- Some 2026 Mario posts unreadable (site blocked full text in fetch); positions inferred from secondary coverage.

## Fit for our agentic stack

Design the factory to satisfy the maintainers' constraints rather than fight them: every worker is a **plain, inspectable pi session** (JSONL kept, HTML export), orchestration lives outside pi, verification is objective-first (tests/mutation/benchmarks as gates; human review for design), skills are CLI+README, and tool schemas track Claude Code's for Anthropic models. Adopt Armin's `/is`-style investigate-and-verify prompt for bug tasks and his "bad state impossible" rubric in the review gate. Treat Earendil's cloud tier as a possible future dependency, not a base.

## Related resources mentioned

- https://github.com/badlogic/agent-tools — CLI+README skills exemplar.
- https://github.com/earendil-works/absurd + "Absurd in Production" — durable execution for the outer loop.
- Shopify `pi-autoresearch` — a sanctioned "outer loop" with objective verification.
- Pragmatic Engineer interview (paywalled beyond intro).
- OpenClaw docs — pi without UI, chat-driven; useful for "agent as service" patterns.

## Key quotes / references

- "It's a black box within a black box." — Zechner on sub-agents, 2025-11-30
- "You ask the agent to extend itself." — Ronacher, 2026-01-31
- "The correct fix is not to handle the bad state, but to make the bad state impossible." — Ronacher, 2026-05-24
- "Tool schemas are not neutral, at least not on Anthropic models." — Ronacher, 2026-07-04
- "Pi should prioritize keeping human judgment intact rather than racing toward fully autonomous software." — Ronacher (paraphrase), 2026-06-23
- "Different projects need different harness types." — Zechner, Pragmatic Engineer

## Gaps / not verified

- Full text of "Thoughts on slowing the fuck down" (2026-03-25) and "shitty-robot" (2026-05-30) not retrieved.
- Earendil compaction/prompt-caching/session-portability posts summarised only in pi.md, not re-read.
- Pragmatic Engineer piece partially paywalled; quotes from the free portion.
- Armin's "Agent Psychosis" (2026-01-18) and "The High Ground" (Earendil, 2026-02-12) skipped as off-topic.
