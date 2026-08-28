# Company agentic-dev write-ups: Ramp Inspect, Stripe Minions, WorkOS Horizon, Brex

- **URLs:** Ramp https://builders.ramp.com/post/why-we-built-our-background-agent (+ InfoQ https://infoq.com/news/2026/01/ramp-coding-agent-platform/ , Modal case study https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal , Pragmatic Engineer https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect) ; Stripe https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents and part 2 https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2 ; WorkOS https://workos.com/blog/project-horizon ; Brex https://www.latent.space/p/brex
- **Type:** factory (internal) x3 + blog (Brex, agent-product org rather than code factory)
- **Researched:** 2026-08-26
- **Status/maturity:** Ramp Inspect: 30% of merged PRs (Jan 2026) -> ~50% (Feb) -> 75% (May 2026), 1M+ sessions by Jul 2026, ~90% of Inspect written by Inspect, team 5.5 people. Stripe Minions: >1,000 (Jan) -> >1,300 (Feb 2026) fully-minion PRs merged/week, all human-reviewed. WorkOS Horizon: in production internally, no numbers. Brex: agent org for ops/product, not a code factory.

## One-paragraph summary

Three internal "background agent" factories with the same skeleton — a pre-warmed sandbox that mirrors the human dev environment, a central MCP tool server, a control plane outside the sandbox, many entry points (Slack/web/CLI/Chrome/PR), and human PR review as the merge gate — differ in what they automate around the agent. Ramp bets on *full context* (agent sees Sentry/Datadog/flags/DB/browser) and multiplayer sessions; Stripe wraps the agent in *Blueprints* (deterministic nodes around agentic nodes, CI capped at two rounds); WorkOS makes the loop *event-driven* off Linear with a PM agent that decomposes projects and cascades dependent work post-merge. Brex is the odd one out: its lessons are about multi-agent org charts, evals, and knowledge bases for product agents, plus a CTO who refuses to track "% code by AI."

## Core ideas / thesis

- Ramp: "Agents should have access to the same context and tools as software engineers." Close "the verification gap": "Inspect is never limited by missing context or tools, but only by model intelligence itself." "When background agents are fast, they're strictly better than local."
- Stripe: "mix the creativity of an agent with the assurance that they'll always complete Stripe-required steps like linters." "investments in human developer productivity over time have returned to pay dividends in the world of agents."
- WorkOS: "event-driven agents, running in secure sandboxes, guided by a shared context surface, and operating in a review-first loop where humans stay in control." "Environment, security, and WorkOS-specific context are the product." "Make the system learn faster than the failures repeat."
- Brex: agents as an org chart that DM each other; "In operations, you need to be able to break down problems really granularly and form SOPs that humans can repeatedly follow."

## Architecture & mechanics

**Ramp Inspect**
- Sandbox: Modal VM per session with "Vite, Postgres, Temporal, the works" plus Redis/RabbitMQ, Chromium, VS Code Server. Repo image rebuilt every 30 min by Modal Cron (clone, deps, build); snapshots are diffs; "Warm the sandbox for your session as soon as a user starts to type their prompt"; <5 s to a full env.
- Agent: OpenCode ("structured as a server first, with its TUI and desktop app just being clients"); any frontier model.
- Control plane: Cloudflare Durable Objects, one SQLite per session, Cloudflare Agents SDK for streaming.
- Integrations: Sentry, Datadog, LaunchDarkly, Braintrust, GitHub, Slack, Buildkite. GitHub App installation token per clone, so a user cannot approve their own agent's PR: "You do not want to knowingly create a vector for unreviewed code."
- Entry points: Slack (classifier routes message+thread+channel name to a repo; agent has a Slack post tool), web, Chrome extension (uses DOM/React internals, not screenshots), PR comments, voice.
- Verification: backend "run tests, review telemetry, and query feature flags"; frontend "visually verifies its work and gives users screenshots and live previews."
- Human touchpoints: prompt, watch/guide live, drop into VS Code, hand session to a colleague (multiplayer), review PR.
- Metrics: merged-PR share; "humans prompting" in last 5 min.

**Stripe Minions**
- Devbox: EC2, same as humans, "cattle, not pets"; warm pool "ready within 10 seconds" (clone giant repos, warm Bazel/typecheck caches, start codegen). QA env only: no prod, no user data, no arbitrary egress; agent runs "with full permissions and skip confirmation prompts."
- Agent: fork of Block's goose, tuned for "fully unattended" (no interruptibility needed).
- Blueprints: "workflows defined in code that direct a minion run"; deterministic nodes (rectangles: "Run configured linters", "Push changes") + agentic nodes (clouds: "Implement task", "Fix CI failures"). "saves tokens (and CI costs) at scale and gives the agent a little less opportunity to get things wrong."
- Validation: ~5 s local heuristic lint on every push; CI (3M+ tests) capped: "only have at most two rounds of CI... prompt the minion to fix failing tests and push a second time, but are then done"; many tests have autofixes.
- Context: Cursor-format rule files scoped to subdirectories, auto-attached as the agent traverses; synced across minions/Cursor/Claude Code.
- Toolshed: central MCP server, ~500 tools (docs, tickets, build status, Sourcegraph); minions get "an intentionally small subset of tools by default"; security control framework blocks destructive actions.
- Entry points: Slack @-mention (consumes thread + links), CLI, web, buttons in internal tools.
- Human touchpoints: kick-off, review PR, optional extra instructions, manual polish.

**WorkOS Horizon**
- Sandbox: Codespaces prototype -> Cloudflare Containers + Sandbox SDK; egress allowlist via Worker proxy (prompt-injection defence); "sandbox flavors" for planning / coding / verification; preview URLs; inter-sandbox comms; full env incl. Docker + DBs.
- Context engine: custom MCP server (Datadog, Sentry, Slack, conventions) — "an iterative product, not a one-time integration."
- Orchestrator (outside sandboxes): webhooks from Linear/GitHub, work-item normalization, sandbox lifecycle (create/pause/resume/destroy), routing back to Slack/Linear/GitHub/web, dependency chains.
- Agent: OpenCode. Identity: PRs attributed to the Linear issue owner via WorkOS Pipes OAuth.
- Modes: semi-autonomous (artifact from context) or interactive chat; "A human is always in the loop when the agent hands off the pull request."
- Post-merge: mark Linear issue done, re-evaluate blocked issues, auto-spawn newly unblocked runs.
- Validation: lint/build/tests today; planned headless-browser verification, screenshot/DOM artifacts, "evidence-based reviews" in PRs, verification in separate sandboxes acting as real clients.
- Self-improvement loop: friction -> monitoring agents detect -> fix PR -> human merge -> next run faster (dep caching, prebuilds, AGENTS.md/CLAUDE.md paved paths).

**Brex (James Reggio, CTO; Camilla Matias, COO)**
- Hierarchical multi-agent "org chart": orchestrator + domain agents (expense, travel, reimbursement, audit, review, policy) that hold multi-turn NL conversations with each other. ~50% Mastra, ~50% custom framework ("the framework is fighting me on this").
- Evals: multi-turn with an AI playing the user, hand-written first turns for determinism; blocking accuracy evals + subjective tone/coherence evals over time. Curated knowledge base to prevent stale-pretraining hallucinations. Greptile for code review. Retool so ops can edit prompts without engineers.
- Metrics: refuses "% code by AI" ("I don't index on those at all"); tracks eval scores, ops automation (80% of applications auto-decided in ~60 s).

## Workflow: end to end (composite)

1. Intake: Slack thread / Linear issue / web / button. (WorkOS: PM agent decomposes a project; human edits each issue; "In Progress" triggers.)
2. Sandbox from a warm pool/snapshot in 5–10 s with full dev env + tool server.
3. Agent implements; deterministic steps (lint, format, push) wrap agentic steps.
4. Validation: local lint -> CI (max 2 rounds at Stripe) -> telemetry/browser checks (Ramp) -> separate verification sandbox (WorkOS).
5. PR opened under the human's identity; human reviews; merge.
6. Post-merge automation (WorkOS) queues dependents; friction becomes platform PRs.

## Notable techniques worth stealing

- Snapshot the repo image on a cron and warm the VM the moment the prompt is being typed (Ramp) — startup latency is the adoption lever.
- Blueprint = deterministic scaffold around agentic nodes; hard cap of two CI rounds then hand back (Stripe).
- Directory-scoped rule files auto-attached on traversal (Stripe).
- Small default tool set from a big central MCP catalogue (Stripe); MCP server treated as a product (WorkOS).
- GitHub App token per clone so no one can self-approve (Ramp).
- Egress allowlist proxy in the sandbox; separate "flavors" for plan/code/verify (WorkOS).
- Post-merge dependency cascade from the tracker (WorkOS).
- Friction -> monitoring agent -> platform fix PR (WorkOS self-improvement loop).
- Multi-turn evals with a synthetic user + separate blocking vs subjective evals (Brex).
- Pick a server-first agent (OpenCode/pi) so clients are cheap (Ramp).

## Weaknesses / open questions / risks

- All three code factories keep human review; none report defect/incident or maintainability data (cf. Faros).
- Ramp/Stripe/WorkOS have big platform teams and deep internal tooling; the "full context" moat is expensive.
- Stripe's two-round CI cap pushes failures back onto humans; unknown fraction returned.
- WorkOS is early; verification beyond lint/build/test is roadmap.
- Brex is about product agents, not coding agents; transfer is by analogy only.

## Fit for our agentic stack (solo, pi, cloud VMs)

- **Adopt:** pi as server-first core (like OpenCode for Ramp/WorkOS); one VM per task from a snapshot rebuilt nightly; a tiny "toolshed" MCP with a default subset; per-run GitHub App token; egress allowlist.
- **Adopt Stripe's blueprint** as our pipeline shape: `[restore snapshot] -> (pi: implement) -> [lint/format/typecheck] -> [push] -> CI -> (pi: fix, once) -> [push] -> hand to human`. Encode the max-2-CI-rounds rule.
- **Adopt WorkOS's tracker-as-state-machine + cascade:** GitHub Issues/Linear "In Progress" triggers; merged PR unblocks dependents; a "PM" pi run decomposes an epic and the solo dev edits issues before dispatch.
- **Adapt Ramp's verification:** give pi access to local logs/DB/preview URL + a headless browser; screenshots attached to PR as evidence.
- **Adapt Brex:** synthetic-user e2e evals for any agentic feature we build; separate blocking vs quality evals.
- **Skip:** multiplayer, Chrome extension, Slack routing classifier (solo dev, one repo).

## Related resources mentioned

- Block goose https://github.com/block/goose (Stripe's base)
- OpenCode (Ramp/WorkOS agent), Modal sandboxes, Cloudflare Sandbox SDK/Containers, Cloudflare Durable Objects + Agents SDK
- WorkOS Pipes (OAuth for agents) — https://workos.com
- Mastra framework, Greptile, Braintrust
- Signadot "Ramp's Inspect shows closed-loop AI agents are software's future"; MindStudio blueprint-architecture explainer

## Key quotes / references

- Ramp: "Over 80% of Inspect itself is now written by Inspect." ; "Owning the tooling lets you build something significantly more powerful than an off-the-shelf tool will ever be. After all, it only has to work on your code."
- Stripe: "Over a thousand pull requests merged each week at Stripe are completely minion-produced, and while they're human-reviewed, they contain no human-written code."
- WorkOS: "no code gets merged without explicit human approval, but the downside is that humans are frequently the bottleneck." ; "every run ships work and produces the next set of fixes."
- Brex: "I don't index on those at all. I don't... honestly calculate that number."

## Gaps

- Ramp primary post partially summarized; cost per session not published. Stripe: fraction of minion runs that fail after 2 CI rounds unknown; blueprint DSL not shown. WorkOS: no metrics at all. Brex: transcript-level detail of the coding workflow (vs product agents) not extracted.
