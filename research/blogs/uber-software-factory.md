# How Uber built a software factory for agentic coding (Port newsletter + Uber primary sources)

- **URL:** https://newsletter.port.io/p/how-uber-built-a-software-factory
- **Type:** blog
- **Author/Org:** Zohar Einy (Port, "Autonomous Engineering" newsletter), summarizing the AI Engineer World's Fair talk "Agentic SDLC at Uber" by Uday Kiran Medisetty (Distinguished Engineer) and Adam Huda (lead, AI Developer Tools). Cross-checked against Uber Engineering Blog posts and the ICSE-SEIP '26 AutoCover paper.
- **Researched:** 2026-08-26
- **Status/maturity:** Newsletter published 2026-08-24; talk video posted ~2026-08-21. Uber's platform is production, company-wide (~5,000 engineers, 6 monorepos). Nothing here is open source; this is architecture-as-described.

## One-paragraph summary

Uber describes a "managed software factory": a six-layer internal platform (model gateway, MCP gateway, warm dev environments, skills registry, context graph, unified assistant "Cortana") on top of which agents (chiefly the cloud coding agent "Minion") do >70% of PRs and doubled lines-of-code per engineer YoY. The load-bearing ideas are not the agents but (a) the platform primitives that make agents cheap, governed, and context-rich, (b) shifting validation *left* into the agent's own environment so it only opens a draft PR after static analysis, visual checks, staging integration checks and a cheap model review have passed, and (c) treating maintenance as scheduled, capacity-aware, opt-in loops with feedback. The earlier Uber tools (uReview, Validator, AutoCover, Genie) are each a worked example of the same pattern: domain-expert agent + deterministic tools + multi-stage filter/grader + real execution as the quality gate + tight metrics/feedback loop. The honest punchline: once agents can build anything, the bottleneck moves to CI capacity, experiment capacity, and deciding *what* to build.

## Core ideas / thesis

- **Platform before agents.** "Without the platform underneath, the AI Software Factory is a set of scripts that break the first time a repo moves or a model changes." Agents need: one map of the org (context graph), one governed tool surface (MCP gateway), one governed model surface (LLM gateway), somewhere fast to run (warm pods), reusable skills, and one place to reach it all (assistant). Framed as "what an OS does for applications."
- **Context is the tax.** Agents wasted tokens/turns discovering basic facts across 20-30 systems; a curated, always-current graph gave "large drops in tokens, turns, and latency." Tool descriptions are also context tax: MCP gateway optimizations saved >40% of tokens fleet-wide.
- **Validate in the inner loop, not in CI.** Pushing agent output straight to CI "hammers shared CI." Minion stops at a *draft PR*, after running validation skills locally. Reviewers get a table of passed checks + screenshots.
- **Precision over volume, guardrails over prompts.** (uReview) Unfiltered LLM output hallucinated; multi-stage generate -> grade -> filter -> dedupe is what made it trustworthy. Devs reject nits; they accept correctness/error-handling findings.
- **Real execution is the oracle.** (AutoCover) A generated test is only "viable" if it compiles, passes, and raises line *or scenario* coverage; then mutation testing and a conventions registry decide whether it lands.
- **Governance as one controlled surface.** "Rather than let thousands of loops run all over the company where nobody can see or stop them, there is one controlled surface." Gateways enforce PII stripping, guard models, cost attribution, and agent identity in <100 ms so nobody routes around them.
- **The constraint moved.** "It's not about, can we build? ... It's more of a question of, should we build it?" CI and A/B-test capacity are now the bottleneck.

## Architecture & mechanics

### The six platform layers (talk / Port article / ZenML summary)

| Layer | What it is | Numbers |
|---|---|---|
| **1. LLM / Model gateway** | OpenAI/Anthropic-compatible Go proxy in front of external + internal models. Pipeline per request: identity/auth -> PII redaction (20+ types) -> "AI Guard" (5 small safety models) -> routing. Tags each call with project/user/team for spend attribution. Hard rule: all checks < 100 ms. | 100M+ requests/day, 800+ projects. Earlier "GenAI Gateway" (2024): ~16M queries/month, ~30 teams |
| **2. MCP gateway** | Single governed entry point to internal APIs (Thrift/Proto/HTTP auto-crawled into MCP servers) and SaaS (Google, Slack, Jira) with central authz, telemetry, logging, registry, sandbox. "Omni MCP" collapses tool descriptions; then CLI-pattern and "code-mode" projections (agent writes a script for heavy ops instead of chaining tool calls); compact response formatting. | 1,000+ tools; >40% fleet-wide token reduction |
| **3. Agentified dev environments ("DevPods" / balloon pods)** | Pre-provisioned Kubernetes pods with repo snapshots and pre-built code-search indexes; agents start in seconds. Moved from per-language pods to "mega devpods" holding all repos so one agent can change backend + frontend together. 12 global sites. | seconds to start |
| **4. Skills registry / marketplace** | Core + team skills; automated lint + review before acceptance; auto-installed by engineer persona/role; one-command discover/install; continuous evals from execution traces + comments fed back to authors. | 2,500 skills, 20,000+ runs/day |
| **5. Context graph** | One graph over apps, services, data lake, design docs, Jira, incidents, bugs, ownership, dependencies. Replaces querying 20-30 systems. "A wiki that is always current." Preferred over pure vector RAG for reliability, at the cost of maintenance. | 150 node/edge types, 40M entries |
| **6. Cortana (unified assistant)** | Slack + CLI + web. Has the graph, skills, and tools plugged in; can read code across repos. Team-specific personas with custom skills/prompts. | 300 personas in month one; 20,000 sessions/day |

Adjacent platform pieces from Pragmatic Engineer / Uber blog: **AIFX CLI** (provision agents, discover MCP servers, run background tasks), **Uber Agent Builder** (no-code agents, multi-agent handoffs), **Agent Studio** (tracing/debugging/versioning/evals), **Michelangelo** (ML platform underneath), **Agent Registry + STS** (agent identity, below).

### Agents and tools (named)

- **Minion** - cloud coding agent, interactive or autonomous, runs in warm pods, edits backend + frontend, runs inner-loop validation skills, then **stops at a draft PR** (does not push to CI).
- **Cortana** - assistant for ideation/spec/research/decision-making; front door to everything.
- **uReview** (CI-time code review; Uber blog Aug 2025) - `Commenter` + `Fixer`. Commenter pipeline: (1) ingest/preprocess: drop config/generated/experimental files, build prompt with surrounding functions/classes/imports; (2) pluggable assistants: Standard (bugs, exception handling, logic), Best-Practices (Uber conventions from a shared style registry), AppSec; (3) post-processing: secondary grading prompt assigns confidence (thresholds tuned per assistant x language x category), semantic-similarity dedupe, category classifier suppressing historically low-value categories; (4) inline comments on Phabricator with Useful/Not-useful buttons, metadata to Kafka/Hive. Fixer proposes code changes for human and AI comments. Best model combo on their golden set: Claude 4 Sonnet generator + o4-mini-high grader; re-benchmarked periodically, highest F1 ships.
- **Validator** (IDE; LangGraph) - central agent coordinates sub-agents: one queries LLM with curated best-practice prompts, one runs deterministic linters; precomputes fixes; dev can apply fix or hand to IDE agent. Thousands of fix interactions/day. Its best-practices registry is reused by AutoCover.
- **AutoCover** (test generation; ICSE-SEIP '26 paper) - five LangGraph agents: **Preparer** (scenario discovery, baseline coverage probe, scaffold canonical test file, repair broken suites) -> **Generator** (per-function generators, existing-test extender, full-file generator, already-tried dedupe) -> **Executor** (artifact plan from build graph, materialize mocks/codegen, run up to 100 tests in parallel with build-safe isolation, attribute coverage per (function, scenario), AST-aware splicing, revert no-signal tests) -> **Validator** (conventions registry with machine-readable rules `<id, severity, span, rationale, patch, confidence>`, bounded mutation testing with surviving mutants attributed to tests, linting, stability cache) -> **Fixer** (per-test parallel repair from diagnostics, bounded context crawler with `ls`/`tree`/`read_file`, "do no harm" rollback, freeze chronic non-improvers). Three modes: CLI, Headless (shard repos, open MRs), IDE (background precompute, 5-min debounce after save, results as editor comments with insert/insert-and-verify/dismiss).
- **Genie** (on-call Slack copilot; EAg-RAG) - pre-retrieval query-rewrite/source-selection agents, hybrid vector+BM25 retrieval over LLM-enriched chunks (summaries, FAQs, keywords; tables converted to markdown), post-retrieval dedupe/ordering agent. Evaluated with LLM-as-judge against SME answers on a 100+ query golden set.
- **Shepherd** (large-scale migrations end-to-end), **Code Inbox** (PR routing), **DragonCrawl** (LLM mobile E2E testing), **Fixrleap** (auto lint/fix), **Lang Effect / LangFx** (Uber's opinionated LangGraph wrapper).
- **Agent identity** (Uber blog 2026): Agent Registry maps agents to workloads; STS issues short-lived, single-hop, audience-scoped JWTs via RFC 8693 token exchange from SPIFFE SVIDs; `act_chain` claim carries user -> agent -> agent -> tool lineage for authz and audit; MCP gateway is the policy enforcement point; P99 < 40 ms; standard A2A client makes secure path the default.

### How output is validated

**Inner loop (pre-CI, inside the agent's pod, all implemented as registry skills using the context graph for "what correct means"):**
1. Static analysis / lint with auto-fix.
2. Visual validation: build in simulator, screenshot, compare to Figma design.
3. Integration checks: run against staging backend + frontend.
4. Lightweight code review with a small, fast model.
5. Agent opens a **draft PR** including a validation table (checks passed, confidence) + screenshots.

**Outer loop:**
6. CI. **Self-healing CI** repairs routine breakages without a human.
7. Deep review with large reasoning models (uReview-style multi-stage).
8. Human reviewer judges quality, not basic errors.

**Tool-level quality gates:** uReview grade->filter->dedupe->suppress; AutoCover compile + pass + coverage-or-scenario gain + mutation + conventions; Validator LLM + linter hybrid.

### Maintenance as managed loops

Teams **enroll** services in scheduled maintenance skills (feature-flag cleanup, A/B variant removal, deprecations, migrations). Runs Sunday when CI is idle; diff volume capped so Monday isn't flooded; acceptance/comment feedback tracked; monthly incident reviews mined for new skills. Results: 250+ migrations, 9M LOC handled automatically.

### Metrics they track

- Platform: requests/day, tokens per fleet, skill runs/day, sessions/day, per-team spend attribution, guardrail latency.
- Adoption (Pragmatic Engineer, Mar 2026): 84% "agentic coding users"; 92% monthly agent users; 65-72% of IDE code AI-generated; Claude Code usage 32% -> 63% in 3 months; 11% of PRs opened by agents (older) -> >70% from local or cloud agents (talk, Aug 2026); LOC/engineer 2x YoY; AI cost up 6x since 2024.
- uReview: 90%+ of ~65k weekly diffs; 75% "useful"; 65% addressed (vs 51% for human comments); median 4 min latency; ~1,500 h/week saved; precision/recall/F1 on golden set; "addressed" verified by re-running review 5x on final commit.
- AutoCover: ~11% of all new reviewed tests; viable-test success rate 20% Java / 40% Go / 80% Python; 44% explicit IDE acceptance; +10% coverage on Dev Platform (~21,000 h); expert rating vs Cursor/Claude Code; telemetry: time-to-first-coverage, accepted tests, mutation survivors, Validator pass rate by rule, flakiness, cache hit rate, compute per accepted test. E2E regression suite pre-merge/nightly/on-demand; SLOs + canaries + one-click prompt rollback.
- Genie: 70k+ answers, 154 channels, 48.9% helpful; EAg-RAG +27% acceptable, -60% incorrect advice.
- Talk's own caveat: PR counts and LOC do not measure quality or business value.

## Workflow: end to end

1. **Idea -> spec**: Cortana in Slack researches the opportunity/competition using context graph; produces product spec.
2. **Design -> prototype**: Figma mock-ups, A/B variants, and reuse recommendations (which existing components/services already do this).
3. **Implementation**: Minion in a mega devpod changes backend + frontend, using skills and MCP tools.
4. **Inner-loop validation**: lint/fix, simulator screenshot vs Figma, staging integration, small-model review. All as skills. Fail -> agent iterates locally.
5. **Draft PR** with validation table + screenshots.
6. **CI + self-healing**; deep-model review (uReview); human review focused on intent/quality.
7. **Merge, ship, measure** via experimentation platform (now a bottleneck).
8. **Maintenance loops** keep the code healthy on a schedule; incidents feed new skills.

## Notable techniques worth stealing

- **Stop at draft PR.** Autonomous agents never push to CI until local validation passes; PR body carries a checks table + screenshots.
- **Validation skills read the source of truth.** Correctness definitions (design spec, staging env, conventions) come from a curated graph/registry, not the agent's guess.
- **Small model in the loop, big model in CI.** Cheap review locally for fast iteration; expensive reasoning review at merge time.
- **Generate -> grade -> filter -> dedupe -> suppress-by-category.** Second prompt scores confidence; thresholds tuned per language/category from human feedback; kill categories devs ignore (style nits, logging, micro-perf).
- **Automatic "was it addressed" measurement**: re-run the reviewer N times on the final commit; if the issue no longer reproduces, count it addressed. No human labeling needed.
- **Golden set + F1 to choose models**, re-run periodically; ship highest F1 combo (generator and grader can be different vendors).
- **Execution + coverage delta + mutation as the oracle for tests**; accept on scenario coverage even if line coverage is flat; reject change-detector tests.
- **Machine-readable best-practices registry** `<id, severity, span, rationale, patch, confidence>` with versioned per-language examples, shared by reviewer, validator and test generator.
- **Stable/semi-stable/volatile prompt blocks** to maximize prompt-cache hits; warm cache with a pilot request before fan-out; normalize diagnostics to stable IDs. (Validator IDE cache hit 91.7%.)
- **Fixer "do no harm"**: patches that break passing tests are reverted; chronic non-improvers frozen; failed strategies remembered so they are not repeated.
- **Bounded context crawler** for the fixer (`ls`, `tree`, `read_file`) instead of dumping the repo.
- **Debounced background precompute** (5 min after save) to hide latency without burning tokens on browsing.
- **Omni-MCP / code-mode**: collapse tool descriptions; let the agent write a script for heavy ops rather than 30 tool calls.
- **Capacity-aware maintenance scheduling** with capped diffs and opt-in enrollment.
- **Incident-review mining** as the backlog source for new skills.
- **Kill switches and remote flags** for agent behaviors separate from the release train.
- **Peer wins over mandates** for adoption.

## Weaknesses / open questions / risks

- The Port article is a vendor newsletter mapping Uber's layers onto Port's product ("context lake", "governance"); numbers are second-hand from the talk. No independent verification.
- Headline metrics (>70% PRs by agents, 2x LOC) are volume, not quality/outcome; the talk itself concedes this. Many agent PRs are scheduled maintenance diffs.
- Six years of monorepo + Bazel groundwork is a precondition for DevPods, build-graph-aware test generation, and self-healing CI. Not reproducible by most orgs.
- Context graph requires ongoing curation; staleness is a silent failure mode.
- AutoCover viable-test rate is only 20% for Java; users complained about style drift, bloat, slowness, ignoring local idioms.
- uReview is blind to design/architecture issues (code-only context), and Fixer quality is not quantified.
- Cost: AI spend up 6x since 2024; every layer exists partly to control that.
- Governance model concentrates power/complexity in a platform team; small orgs cannot staff it.
- Nothing is open source; "skills" here predates/parallels the Claude Code / Agent Skills format and details of their skill format are not public.

## Fit for our agentic stack

Scaled-down mapping of each Uber layer to a solo/small-team Claude Code factory:

| Uber layer | Solo / small-team equivalent |
|---|---|
| Context graph (40M entries) | A maintained `CLAUDE.md` + `docs/` index: service map, ownership, conventions, ADRs, links to specs. Keep it "always current" via a hook or a scheduled skill that diffs docs against code. Prefer structured files over vector search. |
| Skills registry w/ lint + evals | `.claude/skills/` in a shared repo; a `skill-lint` skill/hook; a small eval harness (fixtures + expected outcomes) run nightly; a `SKILL-CHANGELOG`. Persona defaults = per-project `settings.json` allowlists. |
| MCP gateway | One curated `.mcp.json`; keep tool count small (token tax is real); prefer "code-mode" (let Claude write a script against a CLI/API) over many fine-grained MCP tools; wrap internal APIs with one thin MCP server. |
| LLM gateway (PII, guard, attribution, <100ms) | Anthropic API with per-project keys/tags for cost attribution; a `PreToolUse`/prompt hook that scrubs secrets; a budget/limits check. Attribution by workspace is enough. |
| Warm DevPods | Pre-built devcontainer/Docker image or `git worktree` pool with deps installed and index warmed; sandbox per agent run; snapshot so an agent starts in seconds. |
| Cortana | Claude Code itself + a Slack/CLI front door; project-level personas via `CLAUDE.md` variants and custom slash commands. |
| Minion "stop at draft PR" | Headless `claude -p` runs in a worktree that must pass `lint`, `test`, screenshot/visual check, and a cheap-model self-review before opening a **draft** PR whose body includes the check table + screenshots. Enforce with a `Stop` hook that blocks PR creation if checks are missing. |
| Inner-loop validation skills | `validate-static`, `validate-visual` (Playwright screenshot diff vs design), `validate-integration` (hit local/staging), `self-review` (Haiku/Sonnet). Each a skill; each reads conventions from the repo registry. |
| Self-healing CI | A CI job that, on failure, invokes `claude -p` with the log and a fix budget, pushes to the same branch, capped at N attempts. |
| uReview | GitHub Action: Sonnet generates comments -> second cheap grader scores confidence -> dedupe -> category suppression list in repo -> post only >= threshold. Track "addressed" by re-running on the final commit. Keep a 30-50 PR golden set to compare models. |
| AutoCover | A `gen-tests` skill: baseline coverage -> generate per function -> run -> keep only tests that pass and raise coverage -> mutation spot-check (e.g. `mutmut`/`stryker`) -> conventions check. Reject change-detector tests. |
| Maintenance loops | Scheduled `/loop` or cron routines (dep bumps, flag cleanup, dead code) running off-hours with a cap on open PRs; feed rejections back into the skill prompt. |
| Agent identity / act_chain | Per-agent GitHub tokens/app with minimal scopes; log which skill/agent produced each PR in the PR body; short-lived tokens where possible. |
| Metrics | Per-PR: agent-authored?, checks passed, review comments addressed, reverted?; per-skill: runs, acceptance rate, tokens, cache hit rate. Plain JSONL + a dashboard is enough. |

Adopt: draft-PR gate with validation table; multi-stage review with grader + suppression; execution-as-oracle for tests; conventions registry as machine-readable rules; stable/volatile prompt structure for caching; capacity-capped scheduled maintenance; golden-set model selection.
Adapt: context graph -> structured docs; DevPods -> worktree/container pool.
Skip: full gateways, agent STS, org-wide skill marketplace, five guard models. Not worth it below ~50 engineers.

## Related resources mentioned

- Talk video "Agentic SDLC at Uber" (AI Engineer World's Fair) - https://www.youtube.com/watch?v=17-YSUHo6Lk - primary source; worth a full watch for details the summaries drop (Omni MCP, code-mode, skills evals).
- Uber "Building AI developer tools with LangGraph" (LangChain Interrupt 2025) - https://www.youtube.com/watch?v=Bugs0dVcNI8 - Validator/AutoCover/Lang Effect design.
- AutoCover ICSE-SEIP '26 paper - https://homes.cs.washington.edu/~rjust/publ/auto_cover_icse_2026.pdf - most detailed public description of a production multi-agent test generator incl. caching, quotas, telemetry.
- uReview blog - https://www.uber.com/blog/ureview/ - reviewer pipeline + eval methodology.
- Solving the agent identity crisis - https://www.uber.com/blog/solving-the-agent-identity-crisis/ - STS/act_chain design.
- Enhanced Agentic-RAG (Genie) - https://www.uber.com/blog/enhanced-agentic-rag/ - LLM-as-judge eval loop.
- DragonCrawl - https://www.uber.com/blog/generative-ai-for-high-quality-mobile-testing/ - LLM-driven mobile E2E tests.
- Pragmatic Engineer, "How Uber uses AI for development" - https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development - adoption metrics, AIFX CLI, Agent Builder/Studio, org lessons.
- Port, "Agentic SDLC: software lifecycle rebuilt around agents" - https://www.port.io/blog/agentic-sdlc-software-lifecycle-rebuilt-around-agents - vendor framing, lower priority.
- ZenML LLMOps DB entry (talk summary) - https://www.zenml.io/llmops-database/building-a-managed-software-factory-with-agentic-ai

## Key quotes / references

- "Without the platform underneath, the AI Software Factory is a set of scripts that break the first time a repo moves or a model changes." (Port)
- "Rather than let thousands of loops run all over the company where nobody can see or stop them, there is one controlled surface." (Port)
- "The hard rule is that all of this finishes in under 100 milliseconds, so the guardrails never become the reason a request is slow." (Port)
- "Pushing straight to CI was fine for small cleanup work but wasteful for real features, because it hammers shared CI." (Port)
- "It's not about, can we build? We know we can probably build it now. It's more of a question of, should we build it?" (Adam Huda, talk)
- "More than 70% of our PRs [are] now either by local or cloud agents." (Uday Kiran Medisetty, talk)
- uReview: "unfiltered outputs led to hallucinated issues"; multi-stage chained prompts "improved reliability" more than prompt design. 75% useful, 65% addressed vs 51% for human comments.
- AutoCover: "A test case is viable only if it successfully executes and either raises code coverage or scenario coverage." Fixer "enforces a 'do no harm' policy: patches that degrade passing tests are reverted."
- Pragmatic Engineer: "Top-down mandates are less efficient than engineers sharing their wins with peers"; AI-related costs up 6x since 2024.

### Primary sources

- Port newsletter (the assigned article): https://newsletter.port.io/p/how-uber-built-a-software-factory
- Talk: Agentic SDLC at Uber, Medisetty & Huda, AI Engineer World's Fair: https://www.youtube.com/watch?v=17-YSUHo6Lk (summaries: https://www.startuphub.ai/ai-news/artificial-intelligence/2026/uber-s-agentic-sdlc-building-the-future-of-software , https://finance.biggo.com/news/70bdc93df329b24b , https://www.zenml.io/llmops-database/building-a-managed-software-factory-with-agentic-ai)
- Uber blog, uReview: https://www.uber.com/us/en/blog/ureview/
- ICSE-SEIP '26, AutoCover (Rastenis, Chou, Roy Choudhary, Just): https://homes.cs.washington.edu/~rjust/publ/auto_cover_icse_2026.pdf (doi 10.1145/3786583.3786918)
- LangChain Interrupt 2025 talk, Uber Developer Platform AI (Validator/AutoCover): https://www.youtube.com/watch?v=Bugs0dVcNI8 (summary: https://www.zenml.io/llmops-database/building-ai-developer-tools-using-langgraph-for-large-scale-software-development)
- Uber blog, Solving the Identity Crisis for AI Agents: https://www.uber.com/us/en/blog/solving-the-agent-identity-crisis/
- Uber blog, Enhanced Agentic-RAG (Genie): https://www.uber.com/us/en/blog/enhanced-agentic-rag/
- Pragmatic Engineer, How Uber uses AI for development (Mar 2026): https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development
- Codingscape summary of GenAI + MCP gateways: https://codingscape.com/blog/inside-ubers-ai-mcp-gateways-blueprint-for-engineering-leaders

### Gaps

- The talk video itself was not transcribed; details come from three independent summaries plus the Port article, which agree on the numbers.
- Uber has no standalone blog post (yet) on the context graph, skills registry, Omni MCP, Minion, Cortana, or self-healing CI; those are talk-only.
- Uber's 2024 GenAI Gateway blog post and the DragonCrawl / Fixrleap posts were not fetched directly (secondary summaries only).
- The Pragmatic Engineer piece is partly paywalled; extracted the public portion.
