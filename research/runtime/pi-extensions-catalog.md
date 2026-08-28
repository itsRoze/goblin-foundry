# pi ecosystem catalog — parallelism, orchestration, sandboxing, observability extensions

- **URL:** https://pi.dev/packages (≈5.6k packages) · https://github.com/BubblePtr/awesome-pi · https://awesome-pi.site/extensions/ · https://github.com/Traveler0014/awesome-pi-agent · npm search `keywords:pi-package`
- **Type:** skills/agents (extension catalog)
- **Author/Org:** community; official examples under `packages/coding-agent/examples/extensions/` in earendil-works/pi
- **Researched:** 2026-08-26
- **Status/maturity:** see per-row column. Note: there is **no official** `@earendil-works` orchestration package; npm scope `@earendil-works` contains only the core monorepo packages (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`, `pi-server`, `pi-client`, `pi-protocol`, `pi-telemetry`, `pi-session-backend-sqlite-node`) plus `gondolin`. Everything below is third-party unless marked "official example".

## One-paragraph summary

Because pi core ships no sub-agents, MCP, permissions, or task lists, the ecosystem has exploded with overlapping add-ons: an npm search for `pi-package subagent` alone returns 30+ packages. Three designs dominate parallelism: (a) **subprocess fan-out** (`spawn("pi", ["--mode","json", …])`, the official example's approach; nicobailon, disler, most small packages), (b) **in-process sessions** via the SDK (`createAgentSession` with in-memory `SessionManager`; gotgenes, `pi-subagent-in-memory`, pi-dynamic-workflows), and (c) **terminal-multiplexer panes** (HazAT/cmux, pi-chat/tmux). On top of those sit "code-mode" orchestrators where the LLM writes a JS script using `agent()/parallel()/pipeline()` (tintinweb, QuintinShaw, pi-fabric) and coordination layers (file-based `pi-messenger`, HTTP/SSE `coms-net`, `pi-agent-bus`). Sandboxing extensions are `tool_call` policy engines (`pi-guardrails`, `pi-permission-system`) or OS sandboxes wrapping bash (`pi-sandbox`); the official isolation is Gondolin/Docker/OpenShell (see pi-remote-and-sandboxing.md). Observability is thin: Langfuse exporter, cache-hit graph, pi-web supervision UI.

## Catalog

Maturity legend: **A** = >500★, active in last 30 days, docs; **B** = 150–500★ or active but thinner; **C** = small/experimental/stale.

### Sub-agents / fan-out / orchestration

| name | install | what it does | spawn mechanism | maturity |
|---|---|---|---|---|
| **pi-subagents** (nicobailon) | `pi install npm:pi-subagents` | The de-facto standard (3.3k★, pushed 2026-08-26, MIT, ~330k dl/mo). 6 built-in agents (scout, researcher, worker, reviewer, oracle, delegate) as markdown+frontmatter (`name, description, tools, model, systemPromptMode, inheritProjectContext, async, timeoutMs, acceptance`) in `~/.pi/agent/agents/**`, `.pi/agents/**`, or packages (`pi.subagents.agents`). Foreground/background/parallel; `context: "fork"` = real session fork of the parent; JS `workflowScript` (`runs.run`, `runs.all`) with `timeoutMs/turnBudget/toolBudget/usageBudget`; `worktree: true` per child (branch from clean HEAD, journal, capture patch, delete branch); `contact_supervisor` (need_decision/interview_request/progress_update) ↔ `subagent_supervisor({action:"reply"})`; missions (durable state); `/subagents-fleet` inspector; artifacts in `<tmpdir>/pi-subagents-<scope>/async-subagent-runs/<id>/{status.json,events.jsonl,output-n.log,subagent-log-<id>.md}`; **extension API**: in-process RPC over `pi.events` (`subagents:rpc:v1:request` → `spawn/steer/resume/stop`), `SubagentDelegationRequest` with JSON-schema structured output, `registerSubagentCapabilityCeiling({allowedAgents, allowedTools, denyExtensions})`, background-work / external-job provider bridges (`runner.type: external-job` with `start/status/result/reattach`), `resolveSubagentLaunchContract()` preflight digest, `registerExternalRun()` for FleetView, Herdr (herdr.dev) pane integration, Orca observer tabs. Caps: `maxSubagentSpawnsPerRun` 64, `maxSubagentSpawnsPerSession`, `globalConcurrencyLimit`, abandoned-slot reclaim after 20 min. | native pi child processes ("native Pi children keep the same process, lifecycle…"); also external CLI runner profiles | **A** |
| **@tintinweb/pi-subagents** | `pi install npm:@tintinweb/pi-subagents` | Claude Code look-alike (972★, 2026-08-25, MIT): `Agent`, `get_subagent_result`, `steer_subagent` tools; background by default, concurrency default 10 with queueing; `@agent` mentions from the prompt; `SubagentWorkflow` tool runs a deterministic JS script (`agent()`, `parallel()`, `pipeline()` (no stage barrier), `phase()`, `log()`, `args`, `meta`) in a `node:vm` worker where `Date.now/Math.random/eval` throw — **Claude Code `Workflow` scripts run unchanged**; `agent({gate:"npm test"})` verifies a child by command inside its worktree; `resume:"<label>"`; `resumeFromRunId` replay cache; git-worktree isolation with auto-commit to branch; skill preloading; `disallowed_tools`; `allowed_subagents` nesting allowlist + depth cap, nested usage folded into ancestors; cron/interval `schedule`; model-scope enforcement vs `enabledModels`; event bus (`subagents:created/started/completed/failed/steered/compacted`) and cross-extension RPC (`subagents:rpc:ping/spawn/stop/consume`); stands down if another `Workflow` tool exists. | isolated pi sessions (in-process) | **A** |
| **@quintinshaw/pi-dynamic-workflows** | `pi install npm:@quintinshaw/pi-dynamic-workflows` | (448★, 2026-08-25, MIT) LLM writes a JS workflow: `agent(prompt,{model|tier,thinking,isolation:"worktree",timeoutMs,tokenBudget})`, `parallel(thunks)` (order-preserving), `pipeline(items,…stages)`, `phase()`, helpers `verify()`, `judgePanel()`, `loopUntilDry()`, `completenessCheck()`; orchestrator runs in a deterministic VM (no fs/net/Date.now); ≤16 concurrent, ≤1000 total per run; tiers `small/medium/big` from `~/.pi/workflows/model-tiers.json`; journaled `resumeFromRunId` re-runs only changed calls; real token/cost per subagent; built-ins `/deep-research /adversarial-review /multi-perspective /code-review /codebase-audit`, `/ultracode`; triggers on word "workflow" or `/workflows run`. | fresh in-memory pi sessions per subagent (SDK) | **B+** |
| **pi-fabric** (monotykamary) | `pi install npm:pi-fabric` | (149★, 2026-08-26, MIT) "programmable tool and agent runtime": model writes a type-checked TS program calling tools/MCP/agents; executed in QuickJS or Node; one-shot workers, durable resident agents, event-driven actors, councils (multi-model deliberation), workflows with durable topics, CAS mesh state, bounded recursive queries. Requires pi ≥0.80.6, Node 24. | in-process | **B** |
| **agent-pi** (ruizrica) | `pi install git:github.com/ruizrica/agent-pi` | (264★, 2026-07-21, MIT) 43-extension suite: `dispatch_agent` teams from `agents/*.md`, chains (`$INPUT` templating), 5-phase pipeline UNDERSTAND→GATHER→PLAN→EXECUTE→REVIEW with parallel dispatch inside phases, guard/injection detection, plan-approval viewers, Shift+Tab mode cycling. Derived from disler's agent-team. | subprocess | **B** |
| **pi-interactive-subagents** (HazAT/Sentry) | `pi install git:github.com/HazAT/pi-interactive-subagents` | (644★, 2026-05-12, MIT) Each subagent runs in its own **cmux/tmux/Zellij/WezTerm pane**; `subagent()` returns immediately; results steered back as async notifications; `caller_ping` (child asks parent, pauses); `subagent_interrupt`; `/plan`, `/iterate` (fork session for isolated fixes); frontmatter `spawning:false`, `deny-tools`; `PI_SUBAGENT_MUX`. | terminal pane per pi process | **B** (stale 3 mo) |
| **@gotgenes/pi-subagents** + `pi-subagents-worktrees` | `pi install npm:@gotgenes/pi-subagents` | (monorepo 182★, 2026-08-25, MIT) "Focused, **in-process** autonomous sub-agent core"; pluggable workspace provider, worktree provider as separate package; companion `pi-permission-system` + `pi-permission-model-judge`, `pi-github-tools`, `pi-session-tools`. | SDK in-process | **B** |
| **roach-pi** (tmdgusya) | `pi install git:github.com/tmdgusya/roach-pi` | (275★, 2026-07-09) "strict engineering discipline" multi-agent suite with verification workflow. | subprocess | **C+** |
| **@narumitw/pi-subagents** / `pi-worktree` (narumiruna/pi-extensions) | `pi install npm:@narumitw/pi-subagents` | (monorepo 439★, 2026-08-26, MIT) single/parallel/chain modes; `pi-worktree` interactive worktree mgmt + session switching; plus planning, LSP, browser tooling. | subprocess | **B** |
| **official `examples/extensions/subagent/`** | copy to `~/.pi/agent/extensions/` | Reference design: `{agent,task}` / `{tasks:[…]}` (max 8, 4 concurrent) / `{chain:[…]}` with `{previous}`; agents in `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`; 50 KB per-task output cap in parent context, full in `details`; children inherit model/thinking unless overridden. | `spawn("pi",["--mode","json","-p","--no-session","--model",…,"--append-system-prompt",tmp])` | official example |
| pi-orchestration (0xKobold), pi-workflow (catlain), pi-agent-bus (kylebrodeur), `@agwab/pi-subagent`, `@pi-archimedes/subagent`, `subagent-isolation`, `@d3ara1n/pi-subagent`, `@ryan_nookpi/pi-extension-subagent`, `pi-subagent-lite`, `@zhushanwen/pi-subagent-workflow`, `@mjakl/pi-subagent`, `@pi-plugins/subagent`, `@melihmucuk/pi-crew`, `pi-subagent-in-memory`, `@heyhuynhgiabuu/pi-task`, `pi-better-subagents` (detached, sandboxed), `avtc-pi-subagent` (nested + compaction), `@diegopetrucci/pi-subagents`, `pi-gauntlet`, `@signalridge/pi-subagents` ("workflow-owned orchestration RPC"), `@agimon-ai/doompi-task` (dependency-aware task graphs), `pi-open-agents` (OpenCode-compatible agent defs), `@nilskluewer/pi-subagent` | npm | Long tail — dozens of one-person variants of the same subprocess/SDK spawn. Useful only as reading material for specific ideas (e.g. `pi-better-subagents` detached sandboxed runs; `doompi-task` DAGs). | mixed | **C** |

### Inter-agent communication

| name | what it does | maturity |
|---|---|---|
| **pi-messenger** (nicobailon, 691★, 2026-08-23) | File-based, no daemon: registry/inboxes under `~/.pi/agent/messenger/`, project logs `.pi/messenger/`; `pi_messenger({action: join|leave|list|send|broadcast|reserve|release})` — **file/dir reservations** block other agents with a "who to talk to" message; crew plan/work/review task states; stuck detection; PID-based cleanup; DMs wake agents via `pi.sendMessage` steering. `pi install npm:pi-messenger`. | **A-** |
| coms / coms-net (disler) | HTTP/SSE hub; see disler-pi-factories.md. | C (demo) |
| @cryptolibertus/pi-peer, agent-comms, pi-agent-bus | local peer messaging / mesh / pub-sub bus. | C |

### Tasks / workflow state

| name | what it does | maturity |
|---|---|---|
| **@tintinweb/pi-tasks** (187★, 2026-08-24) | Claude-Code-style task tracking with dependency DAG and file locks. | B |
| @juicesharp/rpiv-todo / rpiv-workflow, @mjasnikovs/pi-task, gentle-pi, pi-agent-flow, @gonrocca/zero-pi (explore→plan→build→verify), pi-crew, @agimon-ai/doompi-task | state machines / typed multi-stage pipelines / spec-driven flows. | C |
| official `plan-mode/`, `todo.ts`, `git-checkpoint.ts`, `dirty-repo-guard.ts`, `git-merge-and-resolve.ts`, `handoff.ts`, `structured-output.ts`, `file-trigger.ts`, `event-bus.ts` | bundled examples covering read-only planning phase, per-turn git checkpoints, merge conflict resolution, session handoff, `terminate:true` structured output, file-watch triggers, cross-extension event bus. | official examples |

### Sandboxing / policy

| name | what it does | maturity |
|---|---|---|
| **pi-sandbox** (carderne, 215★, 2026-08-20, MIT) | OS-level bash sandbox (Seatbelt/bubblewrap lineage) with file allow/deny and interactive permission prompts. | B |
| **@aliou/pi-guardrails** (262★, 2026-08-23) | `tool_call` hooks: protect `.env*`, block workspace-external access, gate destructive commands. | B |
| **@gotgenes/pi-permission-system** (+ model-judge) | Permission enforcement with deny-first rules and an LLM judge for ambiguous paths. | B |
| official `sandbox/` (sandbox-exec / bwrap + `sandbox.json`), `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `bash-spawn-hook.ts`, `project-trust.ts`, `gondolin/`, `ssh.ts` | bundled reference policies and execution relocation. | official examples |
| @vigolium/piolium | multi-stage security audit with isolated contexts. | C |

### Observability / remote UI

| name | what it does | maturity |
|---|---|---|
| **@jmfederico/pi-web** (632★, 2026-08-24, MIT) | Browser UI that keeps pi sessions alive after disconnect; machines→projects→workspaces→sessions; register **remote machines** so one instance proxies others (recommend SSH tunnel / private net); `npm i -g @jmfederico/pi-web --allow-scripts=node-pty; pi-web install`, :8504; needs pi ≥0.84. Closest thing to a fleet dashboard today. | B+ |
| @ravan08/pi-langfuse (1★, 2026-08-18) | Langfuse traces: tokens, cost, model, tool calls. Tiny but shows the `before_provider_request/after_provider_response` + `tool_execution_*` exporter pattern. | C |
| pi-cache-graph (championswimmer) | live prefix-cache hit/miss visualisation. | C |
| Herdr (herdr.dev) | external pane manager pi-subagents reports to (`HERDR_ENV`, `HERDR_PANE_ID`). | external |
| official `pi-telemetry` package | vendor-neutral span contracts (see pi.md). | official, experimental |

### MCP / tools

| name | what it does |
|---|---|
| pi-mcp-adapter (nicobailon) | lazy MCP proxy tool (~200 tokens). |
| pi-fabric | MCP servers as typed TS calls inside code-mode. |

## Notable techniques worth stealing

- **Capability ceilings** (nicobailon): a session-scoped, non-model-visible intersection of allowed agents/tools that fails a spawn *before* it starts — exactly a factory "phase policy".
- **Structured delegation with JSON-schema result** (`result:{kind:"structured",schema}`) → typed envelopes without prompt hacks.
- **Launch contract digest** (`resolveSubagentLaunchContract()`): hash of agent def + model + tools recorded alongside the run → reproducibility/audit.
- **`gate: "npm test"` on a child** (tintinweb): verification by command in the child's worktree instead of a judge model.
- **Journaled replay** (`resumeFromRunId` in both tintinweb and QuintinShaw): re-run a workflow re-executing only changed `agent()` calls.
- **Worktree-per-child with patch capture and branch cleanup**; auto-commit on completion.
- **Deterministic orchestrator sandbox** (`node:vm` worker where `Date.now/Math.random/eval` throw) → orchestration scripts are replayable.
- **File reservations** (pi-messenger) as a cheap conflict-avoidance protocol when several agents share one checkout.
- **External-job runner bridge** (`runner.type: external-job` with `start/status/result/reattach`) → plug remote VM workers into a local pi's subagent tool.
- **Cross-extension RPC over `pi.events`** with versioned envelopes → one extension can drive another without importing it.
- **Concurrency slot accounting with process-terminal proof** and abandoned-slot reclaim — the kind of bookkeeping our scheduler needs.
- **Nested usage folded into ancestors** for cost attribution at any depth.

## Weaknesses / open questions / risks

- Massive duplication and churn; several top packages are one-maintainer and re-implement Claude Code UX rather than factory needs.
- All in-process designs share one Node process and one `~/.pi/agent` auth — none isolates children by VM; worktree ≠ sandbox.
- Two competing RPC conventions (`subagents:rpc:v1:*` nicobailon vs `subagents:rpc:*` tintinweb); tintinweb disables itself if another `Workflow` tool exists — mixing packages is fragile.
- Extensions run with full process permissions; installing 5.6k-gallery packages into a cloud worker is a supply-chain risk. Pin by version/commit.
- No package provides fleet-level (multi-machine) scheduling; pi-web's remote machines are supervision only.
- Observability packages are immature; nothing exports OTel end-to-end yet.

## Fit for our agentic stack

- **Don't depend on** any sub-agent package inside cloud workers; each worker is one pi process on one task (subprocess/JSON or SDK), and fan-out belongs to our controller. Use nicobailon/tintinweb as **design references** for: capability ceilings, structured delegation envelopes, launch-contract digests, slot accounting, replayable journals.
- **Consider vendoring** small pieces: `pi-guardrails`-style `tool_call` rules, the official `git-checkpoint.ts`, `structured-output.ts` (`terminate:true`), `handoff.ts`.
- **pi-messenger's file-reservation protocol** is worth copying if we ever let >1 agent share a checkout (we shouldn't; worktrees/VMs instead).
- **pi-web** is a candidate solo-dev dashboard for attaching to live worker sessions over SSH tunnels until pi-server matures.
- **External-job runner bridge** is the seam if we want an interactive local pi to dispatch tasks to the cloud factory (`start/status/result/reattach` mapping onto our API).

## Related resources mentioned

- https://github.com/nicobailon/pi-subagents/blob/main/docs/{extension-api,workflows,observability,agents,configuration}.md — the most complete third-party spec.
- https://github.com/tintinweb/pi-subagents/blob/master/docs/{workflows,rpc}.md
- https://herdr.dev — pane manager integrating with pi-subagents.
- https://github.com/jmfederico/pi-web — remote supervision UI.
- https://github.com/gotgenes/pi-packages — in-process subagents + permission system.

## Key quotes / references

- "Scripts written for Claude Code's `Workflow` tool run here unchanged." — @tintinweb/pi-subagents README
- "Hosts reclaiming idle sessions should read run state from async directories … rather than relying on recent-activity heuristics." — pi-subagents extension-api.md
- npm search: `curl 'https://registry.npmjs.org/-/v1/search?text=keywords:pi-package%20subagent&size=25'`

## Gaps / not verified

- Could not fetch nicobailon `docs/architecture.md` (404) — whether default children are subprocesses (`--mode json`) or SDK sessions is inferred ("native Pi children keep the same process"); confirm before copying.
- Did not read tintinweb `docs/rpc.md` or QuintinShaw source for the exact SDK calls.
- Maturity ratings are from GitHub metadata on 2026-08-26, not usage.
- awesome-pi lists (BubblePtr, Traveler0014, awesome-pi.site) partially read; pi.dev/packages not scraped.
