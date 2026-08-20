# Observability for LLM Coding Agents — Research Report

Scope: best practices and tooling for observing a personal "agentic software factory" (Linear-like ticket system + planner→builder→reviewer→documenter pipeline of Claude-based agents), with full observability — swim-lane view per phase, every compiled prompt, every tool call, every cost breakdown. Inspired by `disler/super-simple-software-factory` (SSSF) and `disler/claude-code-hooks-multi-agent-observability`.

Research date: 2026-08-18. Sources prioritized from the last 12 months.

---

## 1. OpenTelemetry GenAI Semantic Conventions — status and verdict

### Current stability (mid/late 2026)

- **Nothing is stable yet.** As of July 2026, "no GenAI-specific span, event, metric, or attribute in the dedicated repository is marked stable" — everything carries a `Development` (formerly "experimental") stability badge. [DEV Community: OpenTelemetry's GenAI semantic conventions are NOT stable yet](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke)
- **The conventions moved to their own repo.** With semantic-conventions **v1.42.0 (June 12, 2026)**, all `gen_ai.*` content was deprecated/moved out of the main `open-telemetry/semantic-conventions` repo into a dedicated `open-telemetry/semantic-conventions-genai` repo; **v1.43.0 (July 3, 2026)** ships none of it in the main repo anymore, and the new repo has not yet cut a versioned release with a finalized schema URL. [John Hodge, "The state of the OpenTelemetry GenAI semantic conventions (July 2026)"](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/) · [OpenTelemetry registry: Gen AI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- **Attribute churn is real and ongoing.** `gen_ai.system` coexists with a renamed `gen_ai.provider.name` (from v1.37.0); token counts appear under both legacy (`prompt_tokens`/`completion_tokens`) and current (`gen_ai.usage.input_tokens`/`output_tokens`) names, depending on which SDK/version instrumented the call. [John Hodge](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)
- Core **chat/embeddings attributes are stable enough to build dashboards on**; **agent and tool-orchestration conventions are still settling**. [OpenObserve: OpenTelemetry GenAI Semantic Conventions](https://openobserve.ai/blog/opentelemetry-genai-semantic-conventions/)

### The span/attribute model (what's shipped conceptually, even if unstable)

- **Span tree**: `invoke_agent` (the agent run) as parent → `chat` spans (each model call) as children → `execute_tool` spans (each tool invocation) as children. `gen_ai.operation.name` spans the full lifecycle: `create_agent`, `invoke_agent`, `invoke_workflow`, `execute_tool`, `retrieval`, `plan`, plus memory operations. [Greptime: How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions) · [OpenTelemetry blog: Inside the LLM Call — GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/)
- **Key attributes**: `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.response.id`, `gen_ai.tool.call.id`.
- **Metrics**: `gen_ai.client.operation.duration` (LLM call latency) and `gen_ai.client.token.usage` (token consumption). [OpenTelemetry blog](https://opentelemetry.io/blog/2026/genai-observability/)
- **Newer additions (2026)**: structured message attributes, first-class agent span types (`invoke_agent`, `chat`, `execute_tool`), retrieval spans for RAG, and an evaluation outcome event `gen_ai.evaluation.result` that correlates eval scores with traced operations. [John Hodge](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)
- Framework reality check: most production frameworks emit a **mix** of old/new conventions simultaneously — this is by design during the transition, not a bug. Strands Agents defaults to frozen (older) behavior; Pydantic AI and Vercel AI SDK 7 favor current names with compatibility shims. [John Hodge](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)

### Is it worth adopting for a homegrown system?

**Recommended posture: adopt OTel *as a transport/interchange layer*, but do not make `gen_ai.*` attribute names your source of truth.**

- The explicit recommendation from a practitioner tracking this closely: don't rely solely on external conventions for production systems; **maintain your own internal representation of telemetry semantics**, pin exact component/instrumentation versions, be ready to read/query both attribute generations, and timestamp/date all observations so you can reason about which convention era produced them. Keep OpenTelemetry as the interchange format (spans/traces you can export to any backend), not as your schema authority. [John Hodge](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)
- Practical implication for this project: define your **own** event/column names for the live UI and database (see §6), and optionally *also* emit OTel-shaped spans (using `gen_ai.*` where convenient) purely as an export path to a third-party backend (Langfuse/Phoenix/etc.) for deep-trace analysis later — never let an unstable upstream spec gate your primary data model.

---

## 2. Claude Code / Claude Agent SDK's own telemetry (directly reusable)

This is arguably the single most load-bearing finding: **Anthropic has already built a fairly complete OTel-based event/span model for Claude Code and the Agent SDK**, and it maps almost 1:1 onto what the "agentic software factory" needs. Docs: [Claude Code Docs — Monitoring](https://code.claude.com/docs/en/monitoring-usage) · [Claude Agent SDK — Observability with OpenTelemetry](https://code.claude.com/docs/en/agent-sdk/observability)

- **Enable with**: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, plus `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER` (traces are beta, gated by `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`), each pointed at an OTLP endpoint (grpc/http).
- **Content redaction is opt-in**, controlled per content type: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_RAW_API_BODIES` (the last can even write full request/response JSON to files, referenced via `body_ref`). Content is truncated to 60KB (`CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`) by default.
- **Metrics** (all tagged with `session.id`, `user.id`, etc.): `claude_code.session.count`, `claude_code.lines_of_code.count`, `claude_code.pull_request.count`, `claude_code.commit.count`, `claude_code.cost.usage` (USD, tagged by `model`/`agent.name`/`skill.name`/`mcp_tool.name`), `claude_code.token.usage` (tagged by `type`: input/output/cacheRead/cacheCreation), `claude_code.code_edit_tool.decision`, `claude_code.active_time.total`.
- **Events (logs)** — this is the richest part and nearly a ready-made schema for "compiled prompts + tool calls + cost + cache":
  - `claude_code.user_prompt` — `prompt`, `prompt_length`, `command_name/source`
  - `claude_code.assistant_response` — `response`, `model`, `request_id`
  - `claude_code.api_request` — `model`, `cost_usd`, `cost_usd_micros`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `speed`, `effort`
  - `claude_code.api_error`, `claude_code.api_refusal`, `claude_code.api_request_body`/`api_response_body` (raw JSON, for deep debugging)
  - `claude_code.tool_result` — `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `tool_input_size_bytes`/`tool_result_size_bytes`, and (with detail flag) full `tool_input`/`tool_parameters` including `bash_command`, `subagent_type`, `mcp_tool_name`
  - `claude_code.tool_decision` — `decision` (accept/reject), `source` (`config`/`hook`/`user_permanent`/`user_temporary`/`user_reject`) — this is your **gate/permission decision trail**
  - `claude_code.permission_mode_changed`, `claude_code.mcp_server_connection`, `claude_code.internal_error`
- **Traces (beta)** — span hierarchy is almost exactly the "phase → prompt → tool" model this project wants:
  ```
  claude_code.interaction              (root span per user prompt; user_prompt, duration_ms)
  ├── claude_code.llm_request          (gen_ai.system=anthropic, gen_ai.request.model, input/output/cache tokens, ttft_ms, stop_reason)
  ├── claude_code.hook                 (hook_event, hook_name, num_success/blocking/error)
  └── claude_code.tool
      ├── claude_code.tool.blocked_on_user   (permission wait)
      ├── claude_code.tool.execution         (tool_use_id, success, error)
      └── (Agent/Task tool) subagent spans   (agent_id / parent_agent_id — nested subagents!)
  ```
  Notably it already carries `agent_id`/`parent_agent_id` and `workflow.run_id`/`workflow.name` attributes — i.e., Anthropic's own schema anticipates multi-agent workflows and partially aligns with OTel's `gen_ai.system`/`gen_ai.request.model`/`gen_ai.tool.call.id`/`gen_ai.response.finish_reasons` naming, so it's a reasonable bridge if you want to also export to an OTel-native backend.
- **Correlation IDs already exist for you**: `prompt.id` (ties all events from one user turn), `tool_use_id` (ties `tool_decision` + `tool_result` + tool spans), `request_id`/`client_request_id` (API-level), `message.uuid` (transcript-level).
- Community integrations already exist to receive this: [ColeMurray/claude-code-otel](https://github.com/ColeMurray/claude-code-otel) (full observability stack for Claude Code), [SigNoz docs](https://signoz.io/docs/claude-code-monitoring/), [AWS CloudWatch guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/coding-agents-claude-code.html), [Dash0 guide](https://www.dash0.com/guides/monitoring-claude-code-opentelemetry), [Elastic Security Labs](https://www.elastic.co/security-labs/claude-code-cowork-monitoring-otel-elastic).
- **Practical takeaway**: if the pipeline's coding agents run on the Claude Agent SDK (which shares this exact telemetry system — [Agent SDK Observability docs](https://code.claude.com/docs/en/agent-sdk/observability)), you get compiled-prompt logging, per-tool-call args/results/durations, token/cache/cost breakdowns, and permission/gate decisions **for free** just by turning on env vars and pointing OTLP at a collector — no need to hand-roll hook scripts for this part. Hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, etc.) remain useful for injecting your *own* domain events (ticket ID, phase name, gate verdicts) that Anthropic's telemetry doesn't know about.

---

## 3. How OSS/self-hostable LLM observability platforms model agent runs

| Platform | Core data model | License / self-host | Agent-run fit | Ingestion from Claude Code/Agent SDK |
|---|---|---|---|---|
| **Langfuse** | `Trace` (top-level run) → `Observation`s (typed: `generation`/`span`/`event`, nestable) → optional `Session` (groups traces from one user/workflow) → `Score` (numeric/categorical/boolean quality signal attachable to trace/observation/session) | **MIT**, fully self-hostable via Docker Compose/K8s; acquired by ClickHouse (Jan 2026) but stays open. Storage: ClickHouse for traces/observations/scores (high volume), Postgres for config/users/prompts — real infra to run yourself. | Good: nested observations can represent phase→prompt→tool naturally; sessions can group all phases of one ticket; scores can hold gate/review verdicts. Has a dedicated **"Agent Graphs"** trace-graph view (originally for LangGraph) showing node execution as a graph, not literally swim lanes. | `@observe` Python decorator, LLM client wrappers (`langfuse.openai`, etc.), or generic OTel OTLP ingestion (Langfuse accepts OTLP spans and maps them into its trace/observation model) — best bridge for Claude Code's OTel exporter. |
| **Arize Phoenix** | OTel-native traces/spans for LLM+agent+RAG; plus dataset/experiment/prompt-playground objects | **Open source**, self-hosted with **zero feature gating** (rare among the list); SQLite by default (handles millions of spans), Postgres for heavier throughput (10M+ spans/day) | Good: since it's literally OTel spans under the hood, `invoke_agent`/`execute_tool`-shaped traces render natively. 9,000+ GitHub stars, broad adoption. | Native OTel ingestion — closest philosophical match to "export OTel from Claude Code." |
| **Opik (Comet)** | Traces + spans, built-in eval metrics (hallucination/moderation/relevance), prompt versioning, "agent optimizer" SDK | **Apache-2.0**, self-hostable, enterprise features from day one | Full-stack option covering tracing + evals + prompt mgmt in one open tool | OTel + SDK integrations |
| **Laminar** | "Built from day one for AI agents"; claims 20x trace compression, has a debugger + SQL access to trace data ("Signals") | **Apache-2.0** | Purpose-built for agents; lowest pricing among commercial-with-OSS-core options | OTel-native; has an explicit OpenAI Agents SDK integration |
| **AgentOps** | Session/agent-run-centric, "time-travel debugging," supports 400+ LLMs/frameworks | Available OSS SDK, hosted dashboard | Strongest for **multi-framework** agent debugging, less about deep eval workflows | SDK decorators per framework |
| **Braintrust** | **Switched to a spans-first model in 2026** (BTQL queries now return 1 row per span, not 1 per trace) + `Experiment` objects for eval runs, `Log` for production traces that can become eval datasets | **Not open source** (closed source); "free self-hosting" exists but SSO/RBAC require a paid license even self-hosted | Strongest **eval-first** workflow (CI-gated deployment evals); most generous free tier (1M spans/mo, 10K eval runs) | OTel export target named directly by Vercel AI SDK 7 |
| **W&B Weave** | Matured through 2026 into a full LLM observability/eval platform competing with LangSmith/Arize/Helicone | W&B-hosted primarily; self-host story weaker than Langfuse/Phoenix/Opik | Reasonable if already on W&B for ML | SDK/OTel |
| **Helicone** | Proxy-based logging (sits in front of your LLM calls) plus OSS dashboard | **Open-source**, self-hostable | Simpler mental model (gateway proxy), less rich agent-graph modeling | Proxy-based, also OTel |
| **LangSmith / LangGraph Studio** | Traces/runs tightly coupled to LangChain/LangGraph; **LangGraph Studio** renders live execution as an animated **graph** (not swim lanes) with clickable nodes showing input/output/tokens/latency per node, plus time-travel (fork a run from any checkpoint) | Closed-source SaaS (LangSmith), local dev server for Studio | Best-in-class UI *if* you build on LangGraph; not useful if the pipeline isn't LangGraph-based | LangChain/LangGraph SDK instrumentation, or OTel |

Sources: [Arize: 14 best AI agent observability tools in 2026](https://arize.com/blog/best-ai-observability-tools-for-autonomous-agents-in-2026/) · [Laminar: Top 6 Agent Observability Platforms 2026](https://laminar.sh/article/top-6-agent-observability-platforms) · [Braintrust: AI observability buyer's guide 2026](https://www.braintrust.dev/articles/best-ai-observability-tools-2026) · [Langfuse: Tracing Data Model docs](https://langfuse.com/docs/tracing-data-model) · [Langfuse: Agent Graphs feature](https://langfuse.com/docs/observability/features/agent-graphs) · [Langfuse changelog: Graph view for LangGraph traces](https://langfuse.com/changelog/2025-02-14-trace-graph-view) · [PyImageSearch: LLM Observability with Self-Hosted Langfuse](https://pyimagesearch.com/2026/05/18/llm-observability-with-self-hosted-langfuse-and-vllm/) · [Braintrust: self-hosting release notes](https://www.braintrust.dev/docs/data-plane-changelog) · [Braintrust: Langfuse alternatives 2026](https://www.braintrust.dev/articles/langfuse-alternatives-2026) · [Arize Phoenix guide 2026](https://baeseokjae.github.io/posts/arize-phoenix-observability-guide-2026/) · [LangGraph Studio guide](https://mem0.ai/blog/visual-ai-agent-debugging-langgraph-studio) · [LangSmith Studio docs](https://docs.langchain.com/langsmith/studio)

**Key structural conclusion**: none of these platforms natively render a **"swim lane per pipeline phase"** view — that's a bespoke UI pattern (see §4). Their native visualization is a **trace tree / call graph** (nested spans, or a DAG for LangGraph). You could reshape their data into swim lanes yourself (group observations by a `phase` tag and lay tracks out horizontally on a timeline), but none ship it as a first-class view. This is a genuine gap that favors a custom UI over adopting one of these platforms as the primary visualization surface.

---

## 4. What people log for coding agents specifically — schemas from the field

### disler/claude-code-hooks-multi-agent-observability (hook-event based, real-time)

This is the closest existing prior art to "observability inspired by disler." [GitHub repo](https://github.com/disler/claude-code-hooks-multi-agent-observability)

**Architecture**: `Claude Agents → Hook Scripts (Python/uv) → HTTP POST :4000 → Bun TS server → SQLite (WAL) → WebSocket → Vue 3 client :5173`

**Event envelope** (sent by hook scripts to the server):
```json
{
  "source_app": "string",       // project identifier
  "session_id": "string",
  "hook_event_type": "string",  // see 12 types below
  "payload": { /* type-specific */ },
  "chat": [ /* optional transcript history */ ],
  "summary": "string"           // AI-generated one-liner
}
```
Type-specific fields (`tool_name`, `tool_use_id`, `agent_id`, `notification_type`) are also promoted to top-level columns for easy querying.

**12 hook event types tracked**: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`.

**SQLite `events` table**: `id, source_app, session_id, hook_event_type, payload (JSON), chat (JSON), summary, timestamp`.

**UI**: (a) scrolling **Timeline** of event cards (emoji + tool badge + timestamp, expandable payload); (b) a **"Live Pulse Chart"** — canvas bar chart, one colored bar per session/event, 1m/3m/5m windows; (c) multi-criteria **filters** (app/session/event-type/time); (d) **dual-color session coding** — left border = app color, second border = session color, to visually separate parallel agents at a glance; (e) chat transcript viewer with syntax highlighting and tool emoji legend (💻 bash, 📖 read, ✍️ write, ✏️ edit, 🤖 task, 🔌 mcp).

### disler/super-simple-software-factory (SSSF) — closest match to the user's exact goal

This is a **planner → builder → (scout) → reviewer → documenter** pipeline framework with its own event/DB schema, essentially a reference implementation of what the user wants to build. [GitHub repo](https://github.com/disler/super-simple-software-factory)

**Philosophy**: "Deterministic Python owns the graph; coding agents are bounded nodes inside it." Code controls sequencing/retries/acceptance criteria; agents are bounded single-purpose calls. Three lane *kinds* per phase: **Engineer lane** (human decision points), **Agent lane** (`ph.call(...)`: prompt in → typed JSON envelope out, gate-validated), **Code lane** (deterministic ops: tests, commits, lint — cheaper & more reliable than agents for known work).

**Agent output contract** — every agent returns a typed envelope:
```python
status: "success" | "fail"
summary: str
artifacts: list[str]
notes_for_next_agent: str   # <- explicit handoff-notes field
# + custom fields per agent type
```

**Event pipeline**: `Agents write JSONL to stdout → tracer.py → SQLite (WAL) ← readers poll` — no WebSocket needed; one cursor query (`SELECT * FROM events WHERE adw_id = ? AND rowid > ?`) powers both the *live* monitor and *historical replay* (same query, just re-run from row 0).

**Seven SQLite tables** (this is essentially a ready-made minimal schema):
- `sessions` — top-level run metadata
- `phases` — sequence/status of each phase (planner, builder, reviewer, documenter, ...)
- `events` — individual operations, 10 event types, tool calls folded into single rows: `tool, tool_call_id, args, result_snippet, ok, duration_ms, agent`
- `envelopes` — the typed JSON agent output described above
- `gate_results` — validation reports (pass/fail + reason) run *after* agent output
- `agent_sessions` — per-agent context-window/session tracking
- `processes` — PID tracking to detect/recover stuck runs

**Gates** (run after agent output, validate claims not predictions): `artifacts_exist`, `files_non_empty`, `json_parses`, `diff_matches_claims`, `tests_pass(...)`. A gate failure triggers **re-prompting in the same session** (a correction, not a cold restart) — this preserves context and is cheaper than restarting.

**Visualization**: a Vue+Vite UI (`.claude/skills/sssf/apps/visualizer/`) explicitly renders **sessions, waterfall traces, and tool-call details per phase** — i.e. it already implements something close to the swim-lane/waterfall view the user wants. A related, likely derivative Claude Code skill ("Swimlane Visualization Designer") advertises "standardized UI specifications, including lane layouts, event card designs, and component patterns for Vue and React... WebSocket architecture for live status updates... clear visual representation of planning, building, and fixing stages." [mcpmarket.com listing](https://mcpmarket.com/tools/skills/swimlane-visualization-designer) (fetch was rate-limited; treat as a lead to explore directly rather than a verified spec).

**Config**: one YAML (`sssf.config.yaml`) defines, per agent: model + provider (mixed providers allowed), thinking/effort level, prompt path, tool permissions, write-protected files, and a **color for trace visualization** — i.e., color-per-agent-type is a deliberate design choice baked into the config, not an afterthought.

**Explicitly excluded (their own "not yet built" list)**: cloud deployment, human-approval gates, per-run branching/merge orchestration — worth noting as things the user may need to add themselves.

### Other schemas worth knowing about

- **OpenAI Agents SDK tracing**: `Trace` = one full agent run/workflow (has `trace_id`, optional `group_id` to link related runs, metadata tags). `Span` = one operation (LLM generation, tool call, agent handoff, guardrail check, custom event). Hierarchy: `Runner.run()` → wrapped in `trace()` → each runner call in `task_span()` → each model turn in `turn_span()` → each agent activation in `agent_span()`. Typed span-data classes per span kind (`AgentSpanData`, `GenerationSpanData`, etc.). Default trace name is literally `"Agent workflow"` unless overridden. Exports via `BatchTraceProcessor` → `BackendSpanExporter`; you can register additional processors to also send to your own store. [OpenAI Agents SDK tracing docs](https://openai.github.io/openai-agents-python/tracing/) · [Spans reference](https://openai.github.io/openai-agents-python/ref/tracing/spans/)
- **Vercel AI SDK**: emits OTel spans for model calls, tool executions, agent *steps*, embeddings, errors; `onStepStart`/`onStepFinish` callbacks give hook points for multi-step agent runs. AI SDK 7 names Langfuse, Braintrust, Laminar, LangSmith, Datadog, Sentry, Raindrop as direct OTel export targets. [Vercel AI observability tools guide](https://vercel.com/i/ai-observability-tools) · [SigNoz: Vercel AI SDK observability](https://signoz.io/docs/vercel-ai-sdk-observability/)
- **Mastra**: every agent run/workflow execution/tool call/model interaction → a span; spans compose into a trace = hierarchical timeline. Span schema includes a `type` (tool call / reasoning / state transition / memory op) plus structured `inputs`/`outputs`. Workflow steps capture branching + parallel execution + per-step outputs. [Mastra AI Tracing docs](https://mastra.ai/en/docs/observability/ai-tracing)
- **Inngest / Mastra+Inngest**: workflow steps map onto Inngest's function/step model; suspend/resume and step-level state are tracked via Inngest's pub/sub + dashboard, enabling real-time monitoring of long-running/paused agent workflows. [Mastra Inngest workflow docs](https://mastra.ai/en/docs/workflows/inngest-workflow)
- **Review-finding severity pattern**: findings carry a `severity` (Critical/High/Medium/Low, sometimes P0–P3) and an `autofix_class` (`gated_auto`/`manual`/`advisory`); a hard blocking gate stops medium+-severity findings from proceeding downstream and re-enters the refinement loop instead of failing outright; multi-reviewer agreement can *promote* severity by one level. Verdicts are typically tri-state: `BLOCK` / `CONCERNS` / `CLEAN`. [Severity-Gated Review](https://xpromx.me/knowledge/severity-gated-review)
- **Cache-hit metrics worth logging per phase/call**: Anthropic's own Console now ships a Prompt Caching Dashboard (`platform.claude.com/usage/cache`) tracking **cache read ratio** (% of requests hitting existing cache), **cache usage composition** (uncached / 5-min write / 1-hour write / cache-read, stacked), and **write amortization** (reads per write). A cited real example: 85.4% read ratio, 8.65x write amortization. The single most useful derived cost metric is `cache_read_input_tokens / total_input_tokens`. [Prompt Caching Dashboard coverage](https://phemex.com/news/article/anthropic-unveils-prompt-caching-dashboard-with-key-metrics-75230) · [TianPan.co: Prompt Cache Hit Rate — the production metric your cost dashboard is missing](https://tianpan.co/blog/2026-04-20-prompt-cache-hit-rate-production-metric) · [Claude Code Docs: prompt caching](https://code.claude.com/docs/en/prompt-caching)

---

## 5. UI patterns for real-time agent activity

Findings on legibility, ranked by how directly applicable they are:

1. **Swim lanes (per phase/agent, horizontal tracks)** — the pattern the user wants. General design guidance: swim lanes add "an extra dimension of organization" (who/what owns each track) on top of a timeline, and compose well with Gantt/timeline/Kanban views; but plain swim lanes (without a time axis) don't show *duration* well — for duration-sensitive views you want a **swimlane + Gantt/waterfall hybrid** (lane = phase/agent, x-axis = wall-clock time, bar length = duration). [OfficeTimeline: swimlanes overview](https://www.officetimeline.com/features/swimlanes) · [Miro: what is a swimlane diagram](https://miro.com/diagramming/what-is-a-swimlane-diagram/)
   - Concretely for this project: one horizontal lane per **pipeline phase** (Planner / Builder / Reviewer / Documenter — matching SSSF's model), bars/segments placed by start/end timestamp, sub-segments for each LLM call and tool call within the phase, colored by agent/phase (SSSF explicitly assigns each agent a trace color in config).
2. **"Phase card with prompt + gates + outputs"** — this exact pattern is implemented by SSSF/disler-derived tooling: cards represent a phase, expandable to reveal the compiled prompt, the gate results, and the output envelope (`status`, `summary`, `artifacts`, `notes_for_next_agent`). This is a good complement to swim lanes: swim lanes give you the *macro* timeline; phase cards give you the *micro* drill-down when you click a lane segment.
3. **Trace tree / waterfall (nested spans)** — what Langfuse, Phoenix, Braintrust, and OTel-native tools render by default: parent-child nesting of spans, each with duration bar. Good for deep debugging of a single run; poor for "what are my 5 parallel tickets doing right now" — that's what swim lanes solve that trace trees don't.
4. **Live event feed / timeline** — disler's hook-observability tool: a continuously scrolling list of event cards + a canvas "pulse chart" of colored bars per session. Good for a raw activity firehose / "is anything stuck" glance; the dual-border (app-color + session-color) trick is a cheap, effective way to visually separate concurrently running agents without a legend.
5. **Animated DAG / graph view** — LangGraph Studio's approach: nodes = agent/tool steps, edges = control flow, clickable nodes reveal input/output/tokens/latency, with **time-travel** (fork a new run from any checkpoint). Great for understanding *branching* logic (retries, conditional routes) that a purely linear swim lane hides; worth stealing the "click a node → side panel with full I/O" interaction even if you don't adopt LangGraph itself. [LangGraph Studio guide](https://mem0.ai/blog/visual-ai-agent-debugging-langgraph-studio)
6. **Cost/cache stacked bars** — Anthropic's own Prompt Caching Dashboard pattern (stacked bar of uncached/cache-write/cache-read tokens per period) is a good template for a per-run or per-phase cost breakdown widget.

**Synthesis of what makes these legible**: (a) color is used structurally (one axis = phase/agent, not just decoration), (b) duration is always visually encoded as bar length, not just a number, (c) every visual element is clickable through to raw payload (prompt/tool args/output), (d) parallelism is shown by literal lane separation rather than interleaving in one feed, (e) status (running/success/fail/blocked) needs a distinct, consistent glyph/color independent of the phase color.

---

## 6. Metrics that matter for improving agents over time

### Outcome / quality metrics
- **Success rate per ticket type** — segment by task category (bug fix / feature / refactor / docs), since coding-agent PR-acceptance rates vary hugely by task type; cited 2026 figures put agent PR-acceptance in the 35–64% range across tools, well below "success" as commonly marketed, and *far* below human baseline for some task types. [axify.io: AI coding tools' impact](https://axify.io/blog/ai-coding-tools-impact)
- **Review-finding rate & severity distribution** — findings/PR, split by severity (Critical/High/Medium/Low or P0–P3); track the **reduction rate** over time (e.g., cited case: medium+-severity findings dropped from 45.9%→13.4% after adding a refinement loop). [Severity-Gated Review](https://xpromx.me/knowledge/severity-gated-review)
- **Human-intervention rate** — track every instance a human had to step in: by design (escalation) vs. by necessity (post-hoc correction, including cases the agent marked "success" but a human still had to fix). [Larridin: Agentic Workflows — How to Track Agents and Prove Their Value](https://larridin.com/blog/agentic-workflows-tracking-value)
- **Rework loops** — count of gate-failure→re-prompt cycles per phase per ticket; a ticket needing 4 review↔fix loops is a very different signal than one that passes first try, even if both eventually succeed.
- **Time-to-done** — wall-clock from ticket creation to merged/shipped, broken down by phase (planning time vs. build time vs. review time vs. wait-on-human time).

### Cost / efficiency metrics
- **Cost per ticket / per phase** — sum of `cost_usd` across all `api_request` events grouped by phase; worth tracking from week one since pricing structure (not any single task) drives spend drift. [augmentcode.com: AI Coding Cost Analysis](https://www.augmentcode.com/guides/ai-coding-cost-analysis-agent-token-spend)
- **Token efficiency** — tokens consumed per unit of "useful output" (e.g., per merged LOC, or per successfully-closed ticket); distinguish input/output/cache-read/cache-creation.
- **Cache hit rate** — `cache_read_tokens / (cache_read_tokens + input_tokens)` per phase/agent; a regression here silently inflates cost even if nothing else changes. [TianPan.co](https://tianpan.co/blog/2026-04-20-prompt-cache-hit-rate-production-metric)
- **Tool-error rate** — `tool_result.success=false` count / total tool calls, ideally broken down by `tool_name` and `error_type` — flags flaky tools or bad prompting patterns quickly.

### Process health metrics
- **Retries** (API-level, from `attempt` on `api_request`/`llm_request`) — distinguish transient (network/5xx) from semantic (refusal, malformed output) retries.
- **Gate pass rate per gate type** (`artifacts_exist`, `tests_pass`, `diff_matches_claims`, etc.) — which gate fails most often tells you where to invest prompt-engineering effort.

### Eval loops
- The 2026 practitioner consensus loop: **detect a production failure → turn the representative trace into a test case → build/tune an evaluator (deterministic check or LLM-judge) → replay offline against the test set → redeploy the evaluator into live monitoring.** Production traces become regression tests automatically. [Arize: Compare 7 LLM Evaluation Platforms 2026](https://arize.com/resources/llm-and-agent-evaluation-platforms/)
- **Three layers to score an agent trajectory**: final-answer (score the last message/output only), trajectory (score the sequence of tool calls/decisions), per-turn (score each turn's local correctness). [Confident AI: LLM Agent Evaluation Metrics in 2026](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
- **Prompt-version comparison**: run variant A/B through the identical eval suite over the same replayed tickets, compare scores side by side, promote the winner through a review gate — this is exactly what Braintrust's `Experiment` object and Langfuse's dataset/experiment features are built for. Typical 2026 cadence: ~20-50 prompt "smoke set" on every PR, 200-500 prompt regression set on merge-to-main, 1000+ prompt benchmark at release. [Braintrust / Adaline / Confident AI guides, aggregated](https://www.adaline.ai/blog/complete-guide-llm-ai-agent-evaluation-2026)
- For a ticket-replay system specifically: store the **compiled prompt + full context** (not just the ticket text) as the replay unit, since re-running "the ticket" against a changed prompt template is only a fair comparison if you can reconstruct exactly what the agent saw.

---

## 7. Recommendation: build-your-own vs. embed OSS vs. hybrid

### Recommendation: **hybrid** — own event-log + custom UI for the live "factory floor" view, with optional OTel export to an OSS backend for deep-trace debugging and eval workflows.

**Why not embed an OSS platform as the primary UI:**
- None of Langfuse/Phoenix/Braintrust/Opik/LangSmith/AgentOps render a swim-lane-per-phase or phase-card view natively — their default visualization is a trace tree or (LangGraph only) a DAG. You'd be fighting their UI to get the view that's central to this project's stated goal.
- The project's ticket/phase/gate model (Linear-like tickets, planner→builder→reviewer→documenter, gates, handoff notes) is domain-specific; none of these platforms have a "ticket" or "gate" concept — you'd be mapping your domain onto their generic trace/observation/score primitives, losing fidelity (e.g., gate pass/fail and handoff notes would become ad hoc metadata rather than first-class fields you can query/aggregate on).
- Self-hosting operational cost is non-trivial for several of them (Langfuse needs ClickHouse *and* Postgres; Braintrust's self-host free tier lacks SSO/RBAC without a paid license) — heavy infrastructure for what should be a small personal project.

**Why not pure build-your-own with zero OTel:**
- Reimplementing per-call token/cost/cache accounting, retry tracking, and tool-arg capture from scratch duplicates what Claude Code/Agent SDK's OTel exporter already gives for free (see §2) — that's wasted effort with a real risk of getting cost math wrong.
- Giving up an OTel export path forecloses ever plugging into Phoenix/Langfuse's evaluation tooling (LLM-judge scoring, dataset curation, prompt experiments) later, which is genuinely useful for the eval-loop half of "measure to improve."

**The hybrid architecture (concretely, mirroring SSSF's proven shape):**
1. **Primary store**: your own SQLite/Postgres with the run/phase/event/gate tables below — this is what the live swim-lane UI reads directly (no external dependency, sub-second latency, full control over schema).
2. **Ingestion**: agents (via Claude Agent SDK) emit both (a) your own domain events — ticket id, phase, gate results, handoff notes — via hooks (`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStop`, matching disler's hook-event pattern) written straight to your DB, and (b) standard OTel telemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_TRACES_EXPORTER=otlp`) which you can dual-export: one OTLP endpoint into your own collector (optional, for raw compiled-prompt/tool-arg capture matching an event by `prompt.id`/`tool_use_id`), and one into Langfuse or Phoenix (self-hosted) for the deep-trace / eval-replay workflows.
3. **UI**: bespoke — swim lanes (lane = phase, x = wall clock, bar = duration, colored by agent/status) + click-through phase cards (compiled prompt, tool calls, gate results, output envelope) + a cost/cache stacked-bar widget, built directly against your own event table (fast, no OTel-shape translation needed for the UI critical path).
4. **Eval loop**: separate, off the OTel export — use Phoenix or Langfuse's dataset/experiment features (or Braintrust if the closed-source/paid-SSO tradeoff is acceptable) to replay tickets against prompt variants and score with an LLM judge, feeding results back as a `score` linked by your own `run_id`.

### Suggested minimal event schema (run / phase / event / gate model)

```sql
-- One row per ticket execution (a full pipeline run)
runs(
  run_id UUID PRIMARY KEY,
  ticket_id TEXT,              -- Linear-like ticket ref
  ticket_type TEXT,            -- bug | feature | refactor | docs ...
  status TEXT,                 -- running | success | failed | needs_human
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  total_cost_usd NUMERIC,
  total_input_tokens INT,
  total_output_tokens INT,
  total_cache_read_tokens INT,
  total_cache_creation_tokens INT
)

-- One row per pipeline phase within a run (one swim lane = one phase)
phases(
  phase_id UUID PRIMARY KEY,
  run_id UUID REFERENCES runs,
  name TEXT,                   -- planner | builder | reviewer | documenter
  agent_name TEXT,             -- model/config used, for color-coding
  status TEXT,                 -- pending | running | success | failed | blocked
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  attempt INT,                 -- rework-loop counter (>1 = re-prompted after gate fail)
  compiled_prompt TEXT,        -- full system+user prompt actually sent
  output_summary TEXT,         -- envelope.summary
  output_artifacts JSONB,      -- envelope.artifacts
  handoff_notes TEXT,          -- envelope.notes_for_next_agent
  cost_usd NUMERIC,
  input_tokens INT, output_tokens INT,
  cache_read_tokens INT, cache_creation_tokens INT
)

-- One row per tool call / LLM call / hook event within a phase
events(
  event_id UUID PRIMARY KEY,
  phase_id UUID REFERENCES phases,
  event_type TEXT,             -- llm_call | tool_call | hook | gate | error
  tool_name TEXT,               -- Bash, Edit, Read, mcp__..., or NULL for llm_call
  args JSONB,
  result_snippet TEXT,
  ok BOOLEAN,
  duration_ms INT,
  tokens_in INT, tokens_out INT,
  cache_read_tokens INT, cache_creation_tokens INT,
  cost_usd NUMERIC,
  timestamp TIMESTAMP,
  sequence INT                  -- monotonic order within phase
)

-- One row per gate check run after a phase's agent output
gate_results(
  gate_id UUID PRIMARY KEY,
  phase_id UUID REFERENCES phases,
  gate_name TEXT,               -- artifacts_exist | tests_pass | diff_matches_claims | review_severity
  passed BOOLEAN,
  severity TEXT,                -- for review-type gates: critical|high|medium|low
  detail TEXT,                  -- reason / finding text
  timestamp TIMESTAMP
)
```

(Directly inspired by SSSF's `sessions/phases/events/envelopes/gate_results/agent_sessions/processes` tables — the four here are a condensed version; you can add `agent_sessions`/`processes` back if you need context-window resumption or stuck-run PID tracking.)

### Suggested counters to compute per run (for the metrics dashboard / eval loop)

- `success` (bool) and `final_status` (success / failed / needs_human)
- `total_duration_s` and **per-phase** `duration_s` (time-to-done broken down)
- `total_cost_usd` and **per-phase** `cost_usd`
- `rework_count` = sum of `attempt - 1` across phases (rework-loop count)
- `human_intervention_count` = count of `status = needs_human` transitions or manual gate overrides
- `gate_pass_rate` per `gate_name` (aggregate across runs, to see which gate fails most)
- `review_finding_count` and `review_finding_severity_histogram` (critical/high/medium/low)
- `tool_error_rate` = failed tool events / total tool events (overall and per `tool_name`)
- `cache_hit_rate` = `cache_read_tokens / (cache_read_tokens + input_tokens)` (per run, per phase, trended over time)
- `token_efficiency` = tokens consumed / (LOC merged, or tickets closed) — a rough "cost per unit of output" proxy
- `retry_count` = count of transient API retries (`attempt` > 1 on `llm_call` events, excluding rework loops)

---

## Source list (all URLs referenced above)

- [OpenTelemetry: Gen AI attribute registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [OpenObserve: OpenTelemetry GenAI Semantic Conventions — A Practical Guide](https://openobserve.ai/blog/opentelemetry-genai-semantic-conventions/)
- [DEV Community: OpenTelemetry's GenAI semantic conventions are NOT stable yet (2026)](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke)
- [Greptime: How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)
- [John Hodge: The state of the OpenTelemetry GenAI semantic conventions (July 2026)](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)
- [OpenTelemetry blog: Inside the LLM Call — GenAI Observability with OpenTelemetry (2026)](https://opentelemetry.io/blog/2026/genai-observability/)
- [Uptrace: OpenTelemetry for AI Systems (2026)](https://uptrace.dev/blog/opentelemetry-ai-systems)
- [Zylos Research: OpenTelemetry for AI Agents](https://zylos.ai/research/2026-02-28-opentelemetry-ai-agent-observability/)
- [Telemetry.sh: OpenTelemetry GenAI Outcome Events](https://telemetry.sh/docs/guides/opentelemetry-genai-outcome-events)
- [Claude Code Docs: Monitoring](https://code.claude.com/docs/en/monitoring-usage)
- [Claude Code Docs / Agent SDK: Observability with OpenTelemetry](https://code.claude.com/docs/en/agent-sdk/observability)
- [Claude Code Docs: Prompt caching](https://code.claude.com/docs/en/prompt-caching)
- [ColeMurray/claude-code-otel (GitHub)](https://github.com/ColeMurray/claude-code-otel)
- [SigNoz: Claude Code Monitoring & Observability](https://signoz.io/docs/claude-code-monitoring/)
- [Dash0: Monitoring Claude Code Usage and Costs with OpenTelemetry](https://www.dash0.com/guides/monitoring-claude-code-opentelemetry)
- [AWS CloudWatch: Set up OpenTelemetry for Claude Code](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/coding-agents-claude-code.html)
- [Elastic Security Labs: Claude Code/Cowork monitoring at scale with OTel & Elastic](https://www.elastic.co/security-labs/claude-code-cowork-monitoring-otel-elastic)
- [General Analysis: Claude Code Control and Observability with OpenTelemetry](https://generalanalysis.com/guides/claude-code-control-observability-opentelemetry)
- [disler/claude-code-hooks-multi-agent-observability (GitHub)](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [disler/super-simple-software-factory (GitHub)](https://github.com/disler/super-simple-software-factory)
- [mcpmarket.com: Swimlane Visualization Designer skill](https://mcpmarket.com/tools/skills/swimlane-visualization-designer) (fetch rate-limited; treat as lead only)
- [Langfuse: Tracing Data Model docs](https://langfuse.com/docs/tracing-data-model)
- [Langfuse: Agent Graphs feature](https://langfuse.com/docs/observability/features/agent-graphs)
- [Langfuse changelog: Graph view for LangGraph traces](https://langfuse.com/changelog/2025-02-14-trace-graph-view)
- [PyImageSearch: LLM Observability with Self-Hosted Langfuse and vLLM](https://pyimagesearch.com/2026/05/18/llm-observability-with-self-hosted-langfuse-and-vllm/)
- [PyImageSearch: Manual Tracing, Scores, and Evaluation with Langfuse](https://pyimagesearch.com/2026/05/25/manual-tracing-scores-and-evaluation-with-langfuse-self-hosted/)
- [Arize: 14 best AI agent observability tools in 2026](https://arize.com/blog/best-ai-observability-tools-for-autonomous-agents-in-2026/)
- [Arize: Compare 7 LLM Evaluation Platforms 2026](https://arize.com/resources/llm-and-agent-evaluation-platforms/)
- [Arize Phoenix guide 2026](https://baeseokjae.github.io/posts/arize-phoenix-observability-guide-2026/)
- [Laminar: Top 6 Agent Observability Platforms (2026)](https://laminar.sh/article/top-6-agent-observability-platforms)
- [Laminar: Arize Phoenix Alternatives 2026](https://laminar.sh/article/arize-phoenix-alternatives-2026)
- [Laminar: Braintrust Alternatives 2026](https://laminar.sh/article/braintrust-alternatives-2026)
- [Laminar: Langfuse Alternatives 2026](https://laminar.sh/article/langfuse-alternatives-2026)
- [Braintrust: AI observability tools buyer's guide 2026](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)
- [Braintrust: Agent observability — the complete guide for 2026](https://www.braintrust.dev/articles/agent-observability-complete-guide-2026)
- [Braintrust: Langfuse alternatives 2026](https://www.braintrust.dev/articles/langfuse-alternatives-2026)
- [Braintrust: self-hosting release notes / data-plane changelog](https://www.braintrust.dev/docs/data-plane-changelog)
- [Braintrust: Best self-hosted AI evals tools 2026](https://www.braintrust.dev/articles/best-self-hosted-ai-evals-tools-2026)
- [Braintrust: Best prompt evaluation tools 2026](https://www.braintrust.dev/articles/best-prompt-evaluation-tools-2025)
- [Guptadeepak: Top 5 LLM Observability Platforms 2026](https://guptadeepak.com/tools/top-5-llm-observability-platforms-2026/)
- [OpenAI Agents SDK: Tracing docs](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK: Spans reference](https://openai.github.io/openai-agents-python/ref/tracing/spans/)
- [OpenAI Agents SDK: Traces reference](https://openai.github.io/openai-agents-python/ref/tracing/traces/)
- [Vercel: AI observability tools guide (2026)](https://vercel.com/i/ai-observability-tools)
- [SigNoz: Vercel AI SDK Observability](https://signoz.io/docs/vercel-ai-sdk-observability/)
- [Mastra: AI Tracing docs](https://mastra.ai/en/docs/observability/ai-tracing)
- [Mastra: Observability overview](https://mastra.ai/docs/observability/overview)
- [Mastra: Inngest Workflow docs](https://mastra.ai/en/docs/workflows/inngest-workflow)
- [Mem0: LangGraph Studio guide](https://mem0.ai/blog/visual-ai-agent-debugging-langgraph-studio)
- [LangChain: LangSmith Studio docs](https://docs.langchain.com/langsmith/studio)
- [OfficeTimeline: Swimlanes feature overview](https://www.officetimeline.com/features/swimlanes)
- [Miro: What is a Swimlane Diagram](https://miro.com/diagramming/what-is-a-swimlane-diagram/)
- [xpromx.me: Severity-Gated Review](https://xpromx.me/knowledge/severity-gated-review)
- [Phemex: Anthropic Launches Prompt Caching Dashboard](https://phemex.com/news/article/anthropic-unveils-prompt-caching-dashboard-with-key-metrics-75230)
- [TianPan.co: Prompt Cache Hit Rate — the production metric your cost dashboard is missing](https://tianpan.co/blog/2026-04-20-prompt-cache-hit-rate-production-metric)
- [Galileo: The 2026 Caching Playbook for Agents](https://galileo.ai/blog/the-2026-caching-playbook-for-agents-bigger-prompts-smaller-bills)
- [axify.io: AI coding tools' impact — Metrics, ROI, and Review Signals in 2026](https://axify.io/blog/ai-coding-tools-impact)
- [Larridin: Agentic Workflows — How to Track Agents and Prove Their Value](https://larridin.com/blog/agentic-workflows-tracking-value)
- [Augment Code: AI Coding Cost Analysis — Where Token Spend Really Goes](https://www.augmentcode.com/guides/ai-coding-cost-analysis-agent-token-spend)
- [Confident AI: LLM Agent Evaluation Metrics in 2026](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
- [Adaline: The Complete Guide to LLM & AI Agent Evaluation in 2026](https://www.adaline.ai/blog/complete-guide-llm-ai-agent-evaluation-2026)
- [openobserve.ai: Claude Agent SDK Observability with OpenTelemetry (2026)](https://openobserve.ai/blog/claude-agent-sdk-observability-opentelemetry/)
