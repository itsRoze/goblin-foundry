# pi (earendil-works/pi) — minimal, extensible coding-agent harness

- **URL:** https://github.com/earendil-works/pi (formerly `badlogic/pi-mono`; old URL 301-redirects here) — docs: https://pi.dev/docs/latest — npm: `@earendil-works/pi-coding-agent` (was `@mariozechner/pi-coding-agent`)
- **Type:** runtime
- **Author/Org:** Mario Zechner (badlogic, libGDX author); stewarded by Earendil (Vienna; co-founded by Armin Ronacher) since 2026-04-08. Zechner keeps technical direction.
- **Researched:** 2026-08-26
- **Status/maturity:** ~97.8k stars, 12.1k forks, MIT ("MIT, forever. Non-negotiable"), last push 2026-08-26, 138 open issues, latest release 0.84.3 (2026-08-24). Very active (near-daily releases; lockstep-versioned monorepo). Powers OpenClaw. Package gallery at https://pi.dev/packages lists ~5.6k community packages.

**Identity check:** "pi" is ambiguous (Raspberry Pi, Inflection Pi, pi-network, etc.). The runtime the user means is this one: the TypeScript monorepo whose CLI is `pi`, npm scope `@earendil-works/pi-*`. `badlogic/pi-mono` and `earendil-works/pi` are **the same repository** (renamed/transferred April 2026), not two projects.

## One-paragraph summary

pi is a deliberately minimal terminal coding agent (4 default tools: `read`, `write`, `edit`, `bash`; system prompt + tool defs < 1k tokens) built on three reusable libraries: `pi-ai` (unified multi-provider LLM API), `pi-agent-core` (agent loop, tool execution, steering/follow-up queues), and `pi-tui` (differential-rendering terminal UI). Its thesis is "primitives over features": no MCP, no sub-agents, no permission popups, no plan mode, no todo list in core — all of those exist as TypeScript **extensions** (hot-reloadable, full-process-access modules that register tools/commands/hooks/providers/UI) distributed as npm/git **packages**. Sessions are append-only JSONL **trees** (in-place branching, compaction checkpoints, custom extension entries). It runs interactively (TUI), headless (`-p`, `--mode json`), as a subprocess (`--mode rpc`, JSONL over stdio), or embedded as a library (`createAgentSession`). Newer, still-experimental packages (`pi-server`, `pi-client`, `pi-protocol`, `pi-session-backend-sqlite-node`, `pi-telemetry`, `pi-evals`) point toward remote/multi-session server deployments.

## Core ideas / thesis

- **Context engineering must be observable.** Zechner's founding complaint: harnesses "inject stuff behind your back that isn't even surfaced in the UI". pi shows you everything that goes to the model and lets you replace the system prompt wholesale (`.pi/SYSTEM.md`).
- **Models already know how to be coding agents** (RL-trained), so a giant system prompt is waste. Terminal-Bench 2.0 results and a Databricks internal benchmark (Aug 2026: pi + Opus 4.8 xhigh had highest pass rate, ~3x less context/turn, >2x cheaper per task than Claude Code/Codex) are cited as evidence.
- **"If I don't need it, it won't be built."** Core stays tiny; fork or write an extension. Zechner is explicitly "dictatorial" about scope.
- **Skills (CLI + README) beat MCP** for progressive disclosure (his posts "MCP vs CLI" and "What if you don't need MCP at all?").
- **YOLO by default; sandbox outside the agent.** "If an LLM can read data and execute code, it's game over." Security is the container/VM's job (Docker, Gondolin micro-VM, OpenShell), not a permission popup's.
- **Sub-agents are black boxes;** prefer spawning explicit pi sessions via bash/`--mode json` so everything is inspectable — yet the ecosystem's most-installed packages are exactly sub-agent and MCP shims, which tells you what users actually want.
- **Self-modifying software:** the intended workflow is asking pi to write its own extensions (Armin Ronacher: "rather than downloading pre-built extensions, users ask the agent to extend itself").

## Architecture & mechanics

### Monorepo layout (`packages/`)

| dir | npm package | role |
|---|---|---|
| `ai` | `@earendil-works/pi-ai` | Unified LLM API: `createModels()`, `models.stream/complete`, `getModel(provider,id)`, TypeBox tool schemas, cross-provider handoff (thinking blocks → tagged text), usage/cost tracking, `createProvider()` for custom providers, image in/out, constrained sampling (JSON schema / grammars). 30+ providers. |
| `agent` | `@earendil-works/pi-agent-core` | `Agent` class + low-level `agentLoop()`; tool exec (parallel/sequential); `transformContext`/`convertToLlm` pipeline; `beforeToolCall`/`afterToolCall`/`shouldStopAfterTurn` hooks; `steer()`/`followUp()` queues; custom message types via declaration merging. |
| `tui` | `@earendil-works/pi-tui` | Retained-mode terminal UI with differential rendering (uses `CSI ?2026h/l` synchronized output). Components: `Text`, `Box`, `Container`, editors, overlays. |
| `coding-agent` | `@earendil-works/pi-coding-agent` | The `pi` CLI: `AgentSession`, `SessionManager`, `ModelRuntime`, `DefaultResourceLoader`, `SettingsManager`, extension runtime, modes (tui/print/json/rpc), package manager. `src/`: `cli/ core/ extensions/ modes/ server/ client/ bun/ utils/`, `main.ts`, `config.ts`, `package-manager-cli.ts`. `src/core/` has ~50 modules incl. `agent-session.ts`, `agent-session-runtime.ts`, `session-manager.ts`, `model-runtime.ts`, `resource-loader.ts`, `system-prompt.ts`, `compaction/`, `extensions/`, `tools/`, `telemetry.ts`. |
| `protocol` | `@earendil-works/pi-protocol` | Experimental wire protocol: 4-byte length prefix + CBOR; `hello` handshake; requests/responses, server events, authoritative session **snapshots**. |
| `server` | `@earendil-works/pi-server` | Experimental `PiServer` + pluggable `PiServerListener` transports (Unix socket preset `createUnixServer(service,{path})`; WebSocket auth at HTTP upgrade). You supply a `PiServerService` (list/get/create sessions, model registry). Conformance tests in `/testing`. |
| `client` | `@earendil-works/pi-client` | Transport-neutral `PiClient` (`connect`, `createSession`, `acquireSession`, `attachSession`, `listSessions`; session `subscribe(snapshot)`, `onEvent`, `prompt`, `detach/dispose`). No Node deps; Unix transport as subpath. |
| `session-backends/sqlite-node` | `@earendil-works/pi-session-backend-sqlite-node` | `SqliteSessionRepository` + `createSqliteSessionSearch` (FTS5, lazy triggers) for `node:sqlite`. Part of the in-progress "v4 session" work (durable operation records, global facts, shared sequence numbers, tree-scoped lane views). |
| `telemetry` | `@earendil-works/pi-telemetry` | Vendor-neutral `TelemetryContext.startSpan(cfg, cb)` / `TelemetrySpan` contracts, typed span schemas (`createTypedSpanStarter`), `InMemoryTelemetryContext` reference + conformance tests. Adapters map to OTel/Sentry/logs. No prompts/credentials in attributes by default. |
| `evals` | (internal) | Vitest-based behavioral evals: `createPiCodingAgentHarness()`, `describeEval()`, `evalHarnessTable()`; runs recorded under `.eval/runs.jsonl`; `npm run eval -- --provider x --model y`. |

Runs on Node ≥ 24 and Bun (bun path lazy-loads `jiti`/Babel only for extension transpilation).

### Config & file locations

| path | purpose |
|---|---|
| `~/.pi/agent/` (override: `PI_CODING_AGENT_DIR`) | agent home |
| `~/.pi/agent/settings.json` / `.pi/settings.json` | global / project settings (deep-merged; project wins; relative paths resolve against their own file) |
| `~/.pi/agent/auth.json` (0600) | stored API keys / OAuth tokens (`/login`). Values may be literal, `$ENV_VAR`, or `!shell command` |
| `~/.pi/agent/models.json` | custom providers/models (Ollama, vLLM, proxies); hot-reloaded on `/model` |
| `~/.pi/agent/trust.json` | per-project trust decisions (gates loading of `.pi/` extensions/packages/skills) |
| `~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<ts>_<uuid>.jsonl` | sessions (override: `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `sessionDir` setting) |
| `~/.pi/agent/{extensions,skills,prompts,themes}/` and `.pi/{extensions,skills,prompts,themes}/` | auto-discovered resources; also `~/.agents/skills/`, `.agents/skills/` |
| `~/.pi/agent/npm/`, `.pi/npm/`, `~/.pi/agent/git/<host>/<path>` | installed packages |
| `~/.pi/agent/AGENTS.md` (or `CLAUDE.md`), then every `AGENTS.md`/`CLAUDE.md` walking up from cwd; `AGENTS.override.md` replaces | context files (`--no-context-files` to disable) |
| `.pi/SYSTEM.md`, `~/.pi/agent/SYSTEM.md`, `APPEND_SYSTEM.md` | replace / append system prompt |
| `~/.pi/agent/keybindings.json` | keybindings |

Key settings keys: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `defaultTools` (subset of `read bash powershell edit write grep find ls`), `enabledModels`, `packages`, `extensions`, `skills`, `prompts`, `themes`, `compaction.{enabled,reserveTokens=16384,keepRecentTokens=20000}`, `retry.*`, `steeringMode`/`followUpMode` (`all` | `one-at-a-time`), `defaultProjectTrust` (`ask|always|never`), `shellCommandPrefix`, `shellPath`, `sessionDir`, `httpProxy`, `transport` (`sse|websocket|auto`), `enableAnalytics` (off by default), `enableInstallTelemetry`.

Env vars worth knowing: `PI_CODING_AGENT=true` and `AI_AGENT=pi` are set in child processes; bash tool children get `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL` (handy for nested agents / telemetry). `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_PACKAGE_DIR`, `PI_CACHE_RETENTION=long`, `PI_TELEMETRY`.

### CLI surface (most relevant)

```
pi [prompt]                       # TUI
pi -p "prompt"                    # print mode; stdin is merged into prompt (cat README.md | pi -p "summarize")
pi --mode json "prompt"           # JSONL event stream (session header, agent_start … message_end … agent_end)
pi --mode rpc [--no-session]      # JSONL command/event protocol on stdin/stdout
pi -c | -r | --session <path|id> | --fork <path|id> | --no-session | --name "task" | --session-dir <dir>
pi --model <pattern[:thinking]> --models a,b --thinking high --api-key ... --provider ...
pi --tools read,bash --exclude-tools write --no-builtin-tools --no-tools
pi -e ./ext.ts --skill ./dir --prompt-template ./x.md --no-extensions --no-skills --no-prompt-templates
pi --system-prompt "..." --append-system-prompt "..." --no-context-files
pi -a/--approve | -na/--no-approve   # project trust for a single run
pi install npm:@foo/bar@1.0.0 | git:github.com/user/repo@v1 | /abs/path ; pi remove | list | update
pi print-api-key / print-bearer-token <provider>   # export creds (auto OAuth refresh)
```

Slash commands: `/model`, `/thinking`, `/login`, `/tree`, `/fork`, `/clone`, `/new`, `/resume`, `/compact [instr]`, `/name`, `/session`, `/export`, `/share` (gist), `/reload`, `/skill:<name>`, `/<prompt-template>`.

### Providers

OAuth/subscription: Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, xAI, OpenRouter, Radius. API-key: Anthropic, OpenAI, Google, Azure OpenAI, Bedrock, DeepSeek, Mistral, Groq, Cerebras, xAI, OpenRouter, HF, Together, Qwen, MiMo, Cloudflare, NVIDIA NIM, llama.cpp (`/llama` manages a local router), any OpenAI-completions / Anthropic-messages / Google-generative compatible endpoint via `models.json`. Auth priority: `--api-key` > runtime override > `auth.json` > env var. Mid-session model/provider switching preserves context (thinking traces converted). Extensions can register complete providers (`pi.registerProvider(createProvider({...}))`) including OAuth flows, or just override `baseUrl`/`headers` of a built-in one (proxy/gateway use case).

```json
// ~/.pi/agent/models.json
{ "providers": { "ollama": { "baseUrl": "http://localhost:11434/v1", "api": "openai-completions",
    "apiKey": "ollama", "models": [ { "id": "qwen2.5-coder:7b" } ] } } }
```

### Session model (tree)

JSONL, one entry per line; first line `{"type":"session","version":3,"id","timestamp","cwd","parentSession"?}`. Every other entry has `id`, `parentId`, `timestamp`. Entry types: `message` (user/assistant/toolResult AgentMessage), `model_change`, `thinking_level_change`, `compaction` (summary + `retainedTail` = self-contained checkpoint), `branch_summary` (auto-generated when leaving a branch via `/tree`), `custom` (extension state, **not** in LLM context), `custom_message` (extension-injected, **in** context, optional `display`), `label` (bookmarks), `session_info` (name). Context = walk leaf→root honoring compaction boundaries (`buildContextEntries()` / `buildSessionContext()`).

- `/tree` branches **in place** in the same file (double-Esc by default); `/fork` and `/clone` create new files with `parentSession` pointer.
- Extensions persist state via `pi.appendEntry(type, data)` and read it back from `ctx.sessionManager.getBranch()`; recommended pattern is to store state in tool-result `details` so it branches correctly.
- Compaction auto-fires when `contextTokens > contextWindow - reserveTokens`; `session_before_compact` lets an extension supply its own summary (e.g. via a cheaper model, `serializeConversation()` helper) or cancel.
- In flight: "v4" session architecture (durable operation records, shared sequence numbers, lane views) + SQLite backend with FTS — i.e. multi-writer/remote-friendly sessions. Earendil post "The Session You Cannot Take With You" (2026-07-30) argues for session portability.

### Extension API (the important part)

Extensions are `.ts` modules exporting `default function (pi: ExtensionAPI)` (sync or async), auto-discovered from `~/.pi/agent/extensions/*.ts|*/index.ts` and `.pi/extensions/…`, or from packages/settings/`-e`. Hot-reload with `/reload`. They can have their own `package.json` deps. They run with full process permissions.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
  // 1. tool
  pi.registerTool({
    name: "run_tests", label: "Run tests", description: "Run the project's test suite",
    promptSnippet: "run_tests: run tests, optionally filtered",       // 1-liner injected into system prompt
    promptGuidelines: ["Prefer run_tests over bash for tests"],
    parameters: Type.Object({ filter: Type.Optional(Type.String()) }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const r = await pi.exec("npm", ["test", ...(params.filter ? ["--", params.filter] : [])], { signal, timeout: 600_000 });
      return { content: [{ type: "text", text: r.stdout.slice(-8000) }], details: { code: r.code }, terminate: false };
    },
    renderCall(args, theme) { /* optional TUI */ }, renderResult(result, { expanded }, theme) { /* optional */ },
  });

  // 2. hook: block / mutate tool calls
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && /rm -rf|git push --force/.test(event.input.command))
      return { block: true, reason: "policy", terminate: false };
    // or mutate event.input in place
  });

  // 3. hook: inject context / rewrite system prompt before each LLM call
  pi.on("before_agent_start", async (ev, ctx) => ({ systemPrompt: ev.systemPrompt + "\nCurrent ticket: FOO-123" }));
  pi.on("context", async (ev) => ({ messages: ev.messages.filter(keep) }));  // prune/inject

  // 4. command, flag, shortcut
  pi.registerCommand("review", { description: "Review diff", handler: async (args, ctx) => { ctx.ui.notify("…", "info"); } });
  pi.registerFlag("ticket", { description: "Jira id", type: "string" });
  pi.registerShortcut("ctrl+r", { description: "review", handler: async (ctx) => {} });

  // 5. drive the agent / session
  pi.sendUserMessage("Now run the tests", { deliverAs: "followUp" });   // "steer" | "followUp" | "nextTurn"
  pi.appendEntry("factory/checkpoint", { sha: "…" });                   // persisted, not in LLM context
  pi.setActiveTools(["read", "grep", "find", "ls"]);                     // e.g. read-only phase
  pi.setModel(model); pi.setThinkingLevel("high");
}
```

`ExtensionAPI` also has: `registerProvider/unregisterProvider`, `registerMessageRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`, `getActiveTools/getAllTools/setActiveTools`, `sendMessage(customMessage,{triggerTurn,deliverAs})`, `setSessionName/getSessionName`, `setLabel(entryId,…)`, `exec(cmd,args,{signal,timeout})`, `getFlag`.

`ctx` (ExtensionContext) exposes: `ui` (`select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `custom` (TUI only)), `mode` (`tui|rpc|json|print`), `hasUI`, `cwd`, `isProjectTrusted()`, `sessionManager` (`getEntries`, `getBranch`, …), `modelRegistry`, `model`, `thinkingLevel`, `signal`, `isIdle()`, `abort()`, `hasPendingMessages()`, `getContextUsage()`, `compact({customInstructions})`, `getSystemPrompt()`, `waitForIdle()`, `reload()`, `shutdown()`. Command-context only: `newSession()`, `fork(entryId,{position})`, `navigateTree(id,{summarize,label})`, `switchSession(path)`.

**Full event list** (`pi.on(name, (event, ctx) => …)`):

| group | events | can block/modify |
|---|---|---|
| lifecycle | `project_trust`, `resources_discover` (contribute skill/prompt/theme paths), `session_start` (reason `startup|reload|new|resume|fork`), `session_shutdown`, `input` (`continue|transform|handled`) | trust, resources, input |
| agent | `before_agent_start` (modify system prompt / inject message), `agent_start`, `agent_end`, `agent_settled` (no retries or queued work left), `turn_start`, `turn_end`, `message_start/update/end`, `context` (rewrite message array) | before_agent_start, context |
| tools | `tool_call` (block/mutate), `tool_result` (rewrite content/isError), `tool_execution_start/update/end` | tool_call, tool_result |
| model/provider | `model_select`, `thinking_level_select`, `before_provider_headers`, `before_provider_request` (replace payload), `after_provider_response` | headers, request |
| session | `session_before_switch/fork/compact/tree` (`{cancel:true}`), `session_compact` (custom summary), `session_compact_failed`, `session_info_changed`, `user_bash` (`!cmd` execution — supply custom operations) | before_* |

Tool overriding: register a tool with the same name as a built-in (`read`, `bash`, …) to wrap/replace it — this is how the `sandbox/`, `gondolin/`, and `ssh.ts` examples route execution elsewhere. Built-in tool factories (`createReadTool(cwd, { operations })`, etc.) accept an `operations` object so you can swap the filesystem/exec backend without rewriting the tool.

### Skills, prompt templates, themes, packages

- **Skills**: Agent Skills spec (`SKILL.md` with `name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation`). Descriptions go into the system prompt; the model `read`s the full file on demand; `/skill:name` forces it. Locations above; pi tolerates skill name ≠ dir name. `enableSkillCommands`.
- **Prompt templates**: `prompts/*.md` with `description`, `argument-hint` frontmatter; `$1 $2 $@ ${1:-default} ${@:N:L}`; invoked as `/name args`.
- **Themes**: JSON in `themes/`.
- **Packages**: any npm/git/local dir with `"pi": { "extensions": [...], "skills": [...], "prompts": [...], "themes": [...] }` in `package.json` (or conventional `extensions/ skills/ prompts/ themes/` dirs). Keyword `pi-package` lists it in the gallery. Per-package glob filtering and `autoload:false` in settings.

### Headless / programmatic

**SDK (same process, TypeScript):**

```ts
import { createAgentSession, ModelRuntime, SessionManager, DefaultResourceLoader, defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

const modelRuntime = await ModelRuntime.create();
await modelRuntime.setRuntimeApiKey("anthropic", process.env.KEY!);   // not persisted
const loader = new DefaultResourceLoader({
  cwd, agentDir: getAgentDir(),
  extensionFactories: [{ name: "factory-hooks", factory: (pi) => { pi.on("tool_call", …); } }],
  systemPromptOverride: () => "…",
});
await loader.reload();
const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-opus-4-5"),
  tools: ["read", "bash", "edit", "write"], customTools: [defineTool({...})],
  sessionManager: SessionManager.create(cwd),   // or .inMemory() / .open(path) / .continueRecent(cwd)
  modelRuntime, resourceLoader: loader,
});
session.subscribe((e) => { if (e.type === "tool_execution_start") log(e.toolName); });
await session.prompt("Implement FOO-123 per PLAN.md");
await session.agent.waitForIdle();
const final = session.agent.state.messages.at(-1);
await session.compact("keep test failures"); await session.navigateTree(entryId, { summarize: true, label: "cp" });
```

`createAgentSessionRuntime()` wraps this when you need new/resume/fork/switch flows (rebind subscriptions to `runtime.session` after each switch). `session.steer()` / `session.followUp()` inject messages mid-run. `SettingsManager.create().applyOverrides({...})`.

**RPC (subprocess, any language):** `pi --mode rpc --no-session`; LF-delimited JSON on stdin/stdout. Commands: `prompt` (with `streamingBehavior: steer|followUp`), `steer`, `follow_up`, `abort`, `clear_queue`, `get_state`, `get_messages`, `get_entries` (cursor), `get_tree`, `new_session`, `switch_session`, `fork`, `set_model`, `cycle_model`, `get_available_models`, `set_thinking_level`, `bash`/`abort_bash` (output enters context on next prompt), `set_steering_mode`, `set_follow_up_mode`, `compact`, `set_auto_compaction`, `get_session_stats` (tokens/cost), `export_html`. Events mirror SDK events plus `extension_ui_request` ↔ `extension_ui_response` so an orchestrator can answer `select/confirm/input/editor` dialogs raised by extensions (e.g. a permission gate). Framing gotcha: split on `\n` only (not Node `readline`).

**JSON/print:** `pi --mode json -p "…" --no-session | jq 'select(.type=="message_end")'` — what the bundled `subagent/` example uses to spawn children (`["--mode","json","-p","--no-session","--model",…,"--append-system-prompt",<tmpfile>]`, ≤4 parallel workers).

**Server/client (experimental):** `pi-server` hosts many sessions behind Unix-socket/WebSocket listeners speaking CBOR `pi-protocol`; `pi-client` acquires/attaches session leases and receives authoritative snapshots. No CLI shipped yet; you implement `PiServerService`. This is the seam for a multi-tenant agent farm.

### Sandboxing / parallel agents

Core has **no permission system** (docs/security.md is explicit; prompt injection "cannot be reliably prevented by pi"). Documented patterns (docs/containerization.md):
1. **Docker**: `FROM node:24-bookworm-slim … npm i -g @earendil-works/pi-coding-agent; ENTRYPOINT ["pi"]`; `docker run -e ANTHROPIC_API_KEY -v "$PWD:/workspace" -v pi-agent-home:/root/.pi/agent pi-sandbox`. Never mount host `~/.pi/agent` (auth.json).
2. **Gondolin** (https://github.com/earendil-works/gondolin, 2k stars, Apache-2.0): Linux micro-VMs (QEMU / krun) with a TypeScript host control plane: `VM.create({ vfs: { mounts: { "/workspace": new RealFSProvider(cwd) } }, httpHooks, env })`, `vm.exec()`, allowlisted HTTP/TLS egress with request hooks, **placeholder secrets** swapped for real credentials only for allowlisted hosts, DNS modes, ingress gateway, snapshot/resume, `list/attach` sessions. The bundled `examples/extensions/gondolin/` overrides `read/write/edit/bash` to execute in the VM while pi + provider auth stay on the host. pi-chat runs one Alpine micro-VM per Discord/Telegram channel.
3. **OpenShell**: policy-controlled sandbox (fs/process/network/credential/inference controls), local or remote managed.
4. `examples/extensions/sandbox/` — `sandbox-exec` (macOS) / `bubblewrap` (Linux) wrapping of bash with `~/.pi/agent/extensions/sandbox.json` + `.pi/sandbox.json` policies (allowed domains, denied reads `~/.ssh ~/.aws`, denied writes `.env*`).

Parallelism is not in core; community fills it: `pi-subagents` (nicobailon, 3.3k stars, 330k dl/mo; agents defined as markdown-with-frontmatter under `agents/`, modes single/parallel/chain, worktree isolation, Agent Hub TUI to steer/kill workers), `@quintinshaw/pi-dynamic-workflows` (LLM writes a JS orchestration script using `agent()/parallel()/pipeline()`, `isolation:"worktree"`, up to 16 concurrent/1000 total, tiered model routing), `@tintinweb/pi-subagents`, `@narumitw/pi-worktree`, pi-chat's tmux worker pool.

## Workflow: end to end

(How a task flows today with stock pi + common extensions; there is no built-in "spec → PR" pipeline.)

1. `cd repo && pi --name "FOO-123"` — loads `AGENTS.md` chain, project `.pi/` resources after trust prompt.
2. Optionally `/skill:plan` or a `plan-mode` extension (read-only tool set + PLAN.md); Zechner's stance: plan in a file, not a mode.
3. Agent loops with `read/edit/write/bash`; extension hooks (`tool_call`) enforce policy; `git-checkpoint.ts` stashes before each turn so `/fork` can restore code state.
4. Long runs auto-compact; `/tree` to backtrack a bad branch with an auto branch-summary.
5. Review: `pi-review` (`/review branch|commit|pr`, `REVIEW_GUIDELINES.md`, verdict + findings) or `pi-review-loop` (`/diff-review`, persistent incremental review window with checkpoints stored as `review-loop/checkpoint` session entries).
6. Commit/PR via bash (or `auto-commit-on-exit.ts`); `/export` or `/share` the session for provenance.
7. Headless variant: `pi --mode json -p "$TASK" --no-session --append-system-prompt "$ROLE"` per task in a container/worktree; orchestrator parses `message_end`/`agent_end` and `get_session_stats`.

## Notable techniques worth stealing

- **<1k-token system prompt + 4 tools** and measurably lower cost/turn (Databricks). Don't let the harness bloat context.
- **Structured tool results**: `content` (for the LLM) vs `details` (for UI/state) — plus `terminate: true` to end the loop after a tool (structured-output pattern).
- **Session as a tree of entries with `parentId`** and `custom` entries for extension state; compaction entries with `retainedTail` as self-contained checkpoints; branch summaries when abandoning a path.
- **`tool_call` hook returning `{block, reason, terminate}`** and in-place input mutation = a policy engine in ~10 lines.
- **Tool overriding by name + `operations` injection** to relocate execution (VM/SSH/container) without changing the model-facing schema.
- **`extension_ui_request` over RPC**: human-in-the-loop prompts survive headless mode and can be answered by an orchestrator.
- **Placeholder secrets** (Gondolin): the guest never sees real tokens.
- **`before_provider_request` / `after_provider_response`** hooks: cheap place for request logging, cache-key stamping, budget enforcement.
- **`pi.appendEntry` + `session_start` replay** for durable extension state that forks correctly.
- **Skills over MCP** with `pi-mcp-adapter` as a ~200-token escape hatch when MCP is unavoidable.
- **Evals harness** (`describeEval`, `evalHarnessTable`) that records real sessions — directly usable for skill/prompt A/B in a factory.
- **Terminal env markers** (`PI_SESSION_ID`, `PI_SESSION_FILE`, `AI_AGENT=pi`) so child tooling knows its caller.

## Weaknesses / open questions / risks

- **Zero built-in isolation or permissions.** Every factory deployment must wrap pi in Docker/Gondolin/OpenShell; extensions themselves are arbitrary code with full access (supply-chain risk with 5.6k gallery packages).
- **Sub-agents/parallelism are community add-ons** with divergent designs; nothing official yet. Zechner is philosophically against opaque sub-agents.
- **Server/protocol/session-backend packages are marked experimental/unstable**, and session format is mid-migration (v3 JSONL → "v4" records). Building on them now = tracking a moving target.
- **Rapid release cadence** (0.84.x, near-daily) and BDFL scope control: extension API could still shift; pin versions.
- **Commercial layering**: Earendil plans Fair Source and proprietary tiers ("cloud infrastructure") on top; the seams for an open factory may be exactly what gets monetised. Core stays MIT.
- **No official docs on multi-agent coordination**; containerization doc doesn't cover fleets.
- Docs are strong but scattered (repo `docs/`, pi.dev, Earendil blog, Discord).

## Fit for our agentic stack

Adopt pi as the **execution runtime inside each worker**: one pi process (RPC or SDK) per task, in a Gondolin micro-VM or container, on a git worktree. The factory supplies a small extension package (`@goblin-foundry/pi-factory`) that: enforces tool policy, emits telemetry, writes checkpoints, exposes `run_tests`/`open_pr`-style tools, and answers `extension_ui_request`s from the orchestrator. Orchestration (queueing, retries, fan-out, review gates) lives **outside** pi — Earendil's own `absurd` (Postgres durable-execution, has a pi skill) is a natural fit, or our own scheduler. Skip: relying on core for permissions, MCP, or subagents; treat `pi-subagents`/`pi-dynamic-workflows` as reference designs, not dependencies. Keep Claude Code available for interactive human sessions; use pi where we need full control of context and cost.

## Extension points relevant to a software factory

| extension point | what a factory does with it |
|---|---|
| `tool_call` (block/mutate) | Policy gate: deny `git push --force`, network, writes outside worktree; rewrite commands to go through a proxy; enforce "read-only phase" during planning. Review gate: require an approval token before `bash` that touches CI. |
| `tool_result` | Truncate/summarise huge outputs; scrub secrets before they enter context; attach structured metadata (test pass/fail) for the orchestrator. |
| Tool override (`bash`/`read`/`write`/`edit` with custom `operations`) | Sandbox execution: route into Gondolin VM, Docker `exec`, SSH box, or remote runner; enforce path allowlists at the tool layer. |
| `pi.registerTool` | First-class factory tools: `run_tests`, `lint`, `open_pr`, `query_ticket`, `report_status`, `request_review`, `spawn_worker` (explicit, inspectable sub-runs); `terminate:true` for structured final output. |
| `before_agent_start` / `context` / `systemPromptOverride` | Inject task spec, acceptance criteria, repo conventions, prior-run summaries; prune stale tool output; keep prompt-cache prefix stable. |
| `turn_start` / `turn_end` / `agent_settled` | Checkpoints: `git stash create` or commit per turn (see `git-checkpoint.ts`); budget/turn-count kill switch via `ctx.abort()`; emit progress events. |
| `session_before_compact` / `session_compact` | Custom compaction using a cheap model, preserving test failures and file lists; log compaction as a telemetry event. |
| `pi.appendEntry` / `custom_message` / `setLabel` | Durable factory state in the session (task id, checkpoint SHAs, review verdicts) that survives fork/resume; labels as navigable milestones. |
| `before_provider_request` / `after_provider_response` / `before_provider_headers` | Telemetry (tokens, latency, cache hits), cost caps, routing through an LLM gateway, tagging requests with task/run ids. |
| `pi.registerProvider` / `models.json` | Central gateway/proxy, per-role model routing (cheap reviewer, strong implementer), local models for lint-class tasks. |
| `resources_discover` / `DefaultResourceLoader` overrides | Load role-specific skills/prompts per task from the factory's registry rather than `~/.pi`. |
| `input` transform / prompt templates / skills | Standardised task prompts (`/implement <ticket>`, `/fix-ci <run-id>`), skill library shared with Claude Code (same `SKILL.md` spec, `.agents/skills/`). |
| `ctx.ui.*` + RPC `extension_ui_request` | Human review gates that work headless: orchestrator (or a human via web UI) answers confirm/select prompts. |
| `pi.registerFlag` / `pi.getFlag` | Per-run config (`--task-id`, `--budget-usd`, `--role reviewer`) without env hacks. |
| `session_start` (reason `resume|fork`) / `ctx.fork` / `navigateTree` | Retry-from-checkpoint: fork the session at the last good entry and re-run with new instructions; A/B alternative approaches in one tree. |
| `pi-telemetry` `TelemetryContext` | Plug an OTel adapter; typed span schemas for agent/turn/tool spans across the fleet. |
| `pi-evals` harness | Regression-test skills, prompts, and models against recorded sessions before rollout. |
| `pi-server` / `pi-client` / SQLite session backend | (Experimental) central session service: attach a dashboard, share sessions across machines, search transcripts with FTS. |
| `user_bash` / `bash` RPC command | Orchestrator-run setup commands whose output lands in the next prompt's context (env prep, test results). |

## Comparison vs Claude Code

| dimension | pi | Claude Code |
|---|---|---|
| Core size / prompt | 4 tools, <1k tokens; everything visible; system prompt replaceable | Large system prompt, many tools; behaviour injected by harness |
| Extensibility | TypeScript extensions with full API (tools, commands, hooks, providers, UI renderers, session ops); hot reload; packages via npm/git | Hooks (shell commands/HTTP at lifecycle events), plugins (skills/commands/agents/hooks/MCP bundles), MCP servers; no in-process code API |
| Hooks | ~35 in-process events incl. `tool_call` block/mutate, `tool_result`, `context`, `before_agent_start`, provider request/response, session/compaction lifecycle; extensions can call `ctx.ui` | PreToolUse/PostToolUse/UserPromptSubmit/Stop/SubagentStop/SessionStart/PreCompact/Notification/WorktreeCreate etc. as external processes returning JSON; can block/modify but no in-process state |
| Skills | Agent Skills spec (`SKILL.md`), reads `.agents/skills/` too → shareable with Claude Code | Same spec; plus plugin marketplace |
| Sub-agents | None in core (by design); `pi-subagents`, `pi-dynamic-workflows`, bundled `subagent/` example spawn `pi --mode json` children | Built-in `Agent` tool, `.claude/agents/*.md`, forks, background agents, worktree isolation |
| SDK / headless | First-class TS SDK (`createAgentSession`), RPC JSONL protocol, `--mode json`, experimental server/client/protocol | Claude Agent SDK (TS/Python), `-p` print mode with stream-json; no open wire protocol (ACP via Zed) |
| MCP | Not in core; `pi-mcp-adapter` (~200-token proxy tool), `pi-fabric` | Native MCP client (stdio/HTTP/SSE), OAuth |
| Providers | 30+ providers, OAuth subs (Claude/ChatGPT/Copilot), local models, custom providers, mid-session switching | Anthropic (API, Bedrock, Vertex, Foundry) only |
| Sessions | JSONL tree, in-place branching, fork/clone, custom entries, HTML export, compaction checkpoints; SQLite backend coming | Linear JSONL transcripts with resume/fork; rewind/checkpoints via file snapshots |
| Permissions / sandbox | None; container/Gondolin/OpenShell recommended; policy via extensions | Built-in permission modes, allow/deny rules, sandboxing, managed cloud sandboxes |
| Telemetry | `pi-telemetry` contracts (adapter-based), session stats | OTel export built in |
| Evals | `pi-evals` in-repo | `claude plugin eval` |
| License / control | MIT, community can fork; single-maintainer scope | Proprietary client |

## Related resources mentioned

- https://github.com/earendil-works/gondolin — micro-VM agent sandbox with host control plane; the official pi isolation story.
- https://github.com/earendil-works/absurd — Postgres durable-execution workflow engine "built so agents such as Claude Code or pi can work with the state"; candidate factory orchestrator.
- https://github.com/earendil-works/pi-review and https://github.com/earendil-works/pi-review-loop — official review extensions (checkpointed incremental diff review).
- https://github.com/earendil-works/pi-chat — one sandboxed pi session per chat channel; shows tmux worker pools + Gondolin per session.
- https://github.com/nicobailon/pi-subagents, https://github.com/QuintinShaw/pi-dynamic-workflows, https://github.com/tintinweb/pi-subagents — sub-agent/fan-out designs.
- https://github.com/nicobailon/pi-mcp-adapter — MCP proxy tool.
- https://github.com/carderne/pi-sandbox, https://github.com/gotgenes/pi-packages (permission system), https://github.com/aliou/pi-guardrails — policy/sandbox extensions.
- https://github.com/BubblePtr/awesome-pi, https://github.com/Traveler0014/awesome-pi-agent, https://pi.dev/packages — ecosystem indexes.
- Shopify `pi-autoresearch` (autonomous experiment loop; via Earendil post) — a self-improving optimization loop as a pi extension.
- Earendil blog: "What is a Harness?" (2026-08-20), "How Compaction Works in Pi" (08-13), "Pi, Minimal and Performant" (08-04), "The Session You Cannot Take With You" (07-30), "Prompt Caching In Agents" (07-22), "Announcing Pi & Lefos" (04-08).
- Databricks: "Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase".
- Mario's posts: "What I learned building an opinionated and minimal coding agent" (2025-11-30), "What if you don't need MCP at all?" (2025-11-02), "MCP vs CLI" (2025-08-15), "I've sold out" (2026-04-08); Pragmatic Engineer "Building Pi, and what makes self-modifying software so fascinating"; Armin Ronacher "Pi: The Minimal Agent Within OpenClaw" (2026-01-31).
- https://github.com/badlogic/agent-tools — Zechner's CLI-tools-with-README collection (skills-not-MCP evidence).

## Key quotes / references

- "Existing harnesses make this extremely hard or impossible by injecting stuff behind your back that isn't even surfaced in the UI." — Zechner, 2025-11-30
- "If an LLM can read data and execute code, it's game over… run pi inside a container." — Zechner
- "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access." — README
- "Prompt injection from repository files… is expected local-agent risk and cannot be reliably prevented by pi." — docs/security.md
- "MIT, forever. Non-negotiable." / "the fork button on GitHub still works. Always will." — "I've sold out", 2026-04-08
- "Sub-agents create black boxes; better to spawn explicit sessions via bash with full visibility." — paraphrase, 2025-11-30 post
- Databricks (Aug 2026): pi + Opus 4.8 xhigh "highest pass rate of any harness tested", ~3x less context per turn, >2x cheaper per task.
- Docs: https://pi.dev/docs/latest ; repo docs: `packages/coding-agent/docs/{extensions,sdk,rpc,session-format,sessions,settings,packages,skills,prompt-templates,providers,custom-provider,models,containerization,security,compaction,json,usage,environment-variables}.md` ; examples: `packages/coding-agent/examples/{extensions/*,sdk/01-13}`.

## Not to be confused with

`badlogic/pi-mono` is **not a different project** — it is the pre-April-2026 location of this repo and redirects to `earendil-works/pi`. Old npm name `@mariozechner/pi-coding-agent` (still on npm, stale) → `@earendil-works/pi-coding-agent`. Unrelated "pi"s: Inflection's Pi assistant, Raspberry Pi, Pi Network.

## Gaps / not verified

- Did not read source of `pi-server`/`pi-protocol` beyond READMEs; the exact `PiServerService` interface, auth model for WebSocket listeners, and how `AgentSession` binds to the server (`src/server/create-harness.ts`, 5.7 KB) are unconfirmed.
- "v4 session architecture" and SQLite backend: changelog says shipped/in progress, but `docs/session-format.md` still documents `version: 3` JSONL — unclear whether v4 is default in 0.84.x or still unreleased.
- OpenShell: only known from containerization.md; not researched (vendor? OSS?).
- Exact `context` and `before_agent_start` return shapes were inferred from docs summaries; confirm against `packages/coding-agent/src/core/extensions/types.ts` before coding.
- `pi-subagents` internals (does it use RPC or `--mode json`? worktree cleanup?) not read; Agent Hub claims come from search snippets.
- Earendil's "Lefos" (announced with pi on 2026-04-08) and any hosted/cloud pi offering were not investigated.
- Could not reach earendil.works blog (connection refused); earendil.com posts list obtained but individual posts (compaction, session portability, prompt caching, "What is a Harness?") not read.
- No first-hand test run; version/flag names are from docs as of 2026-08-26.
