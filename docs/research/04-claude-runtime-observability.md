# Claude runtime & observability for a self-hosted agentic software factory

Research date: **2026-08-18**. All facts below are sourced from official docs (code.claude.com, platform.claude.com) or from the published TypeScript SDK type definitions (`@anthropic-ai/claude-agent-sdk@0.3.235`, `sdk.d.ts`, downloaded from unpkg on 2026-08-18). Anything I could not verify is listed in the final section.

---

## 0. TL;DR recommendation

**Run the Agent SDK (TypeScript) inside your own worker process, one `query()` per phase, one subprocess per phase, in a per-ticket git worktree.** Capture events from four sources, each for what it is authoritative about:

| Data | Source | Why |
|---|---|---|
| Turn/message timeline, assistant text, tool_use blocks, subagent tree | **SDK message stream** (`SDKMessage`) | Only place with `parent_tool_use_id`, `uuid`, streamed partials |
| Per-tool-call durations, gating decisions, blocking | **Programmatic hooks** (`PreToolUse`/`PostToolUse`/`PostToolUseFailure`) | `PostToolUseHookInput.duration_ms` is the only first-class per-tool duration; hooks can block (exit 2 / `permissionDecision: "deny"`) |
| Cost & tokens per phase (incl. subagents) | **`result` message** `modelUsage` (not `usage`) | `usage` is main-loop only; `modelUsage` covers subagents + compaction |
| Full compiled prompt sent to the API (system prompt + tools + history) | **OTel log events** `claude_code.api_request_body` with `OTEL_LOG_RAW_API_BODIES=file:<dir>` | The only supported way to see the *effective* compiled prompt |
| Durable, replayable transcript in Postgres | **`sessionStore` adapter** (`append`/`load`) | Official DB mirror hook; reference Postgres adapter exists |
| Cross-service latency waterfall | **OTel traces (beta)** `claude_code.interaction` → `llm_request`/`tool`/`hook` | Nests under *your* span via `TRACEPARENT` propagation |

Do **not** parse `~/.claude/projects/**/*.jsonl` as your primary event source — the docs explicitly say the entry format "is internal to Claude Code and changes between versions."

---

## 1. Hosting options for the agents

### 1.1 The three options, per Anthropic's own comparison

From <https://code.claude.com/docs/en/agent-sdk/overview>:

| If you're… | Use | Why |
|---|---|---|
| Building an agent without implementing the tool loop yourself | **Agent SDK** | A library that runs the agent loop **in your own process**, Python or TypeScript |
| Interactive dev / one-off terminal tasks | **Claude Code CLI** | Terminal interface |
| Calling the API and implementing the tool loop yourself | **Client SDK** (Messages API / Tool Runner) | Direct API access; you implement the loop |
| Long-running/async agents without managing your own sandbox or session infra | **Managed Agents** | Hosted REST API; **Anthropic runs the agent and the sandbox** |

> "The SDK is available as a library for Python and TypeScript only. To drive the same agent loop from another language, [run the CLI as a subprocess](https://code.claude.com/docs/en/headless) with the `-p` flag and `--output-format json`."

**Critical architectural fact:** the Agent SDK is *not* an in-process agent loop. It **spawns and supervises a `claude` CLI subprocess and talks to it over stdio** (<https://code.claude.com/docs/en/agent-sdk/hosting>):

> "When your code calls `query()`, the SDK spawns a separate `claude` CLI process and talks to it over stdio. That subprocess owns the shell, the working directory, and the JSONL session transcripts on local disk."
> "One agent session maps to one subprocess. Running N concurrent sessions means N subprocesses."

So "SDK-in-a-worker" vs "spawn the CLI" is **the same runtime**; the SDK just gives you typed messages, callbacks (`canUseTool`, hooks), and a `sessionStore` hook that raw CLI stdio does not.

Both SDKs **bundle a native Claude Code binary pinned to the SDK package version** — "updating the SDK is how you update the CLI."

### 1.2 Agent SDK (recommended for the factory)

Packages:
- TypeScript: `@anthropic-ai/claude-agent-sdk` — latest published version **0.3.235** (verified via npm registry on 2026-08-18); types at `sdk.d.ts`, entry `sdk.mjs`.
- Python: `claude-agent-sdk`.

Runtime deps (from hosting doc): Node.js 18+ (TS) or Python 3.10+.

**Resource sizing (official starting point):**
> "1 GiB RAM, 5 GiB disk, and 1 CPU per agent is a reasonable starting point… `agents per host = (host RAM - overhead) / (per-session RAM ceiling)`"

**Known limitations** (hosting doc, verbatim table):
| Limitation | What to do |
|---|---|
| No top-level session timeout | Set `maxTurns` in `Options` |
| Memory growth over long sessions | Cap session length or recycle subprocesses |
| Large parallel-subagent fanouts can hit rate limits | Break work into smaller batches |
| No per-subagent wall-clock deadline | Cap each subagent with `maxTurns`; `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` is a stall watchdog only (background subagents) |

**Multi-tenant / isolation knobs** (hosting doc):
```ts
for await (const message of query({
  prompt,
  options: {
    cwd: tenantDir,
    settingSources: [],                       // no filesystem settings at all
    env: {
      ...process.env,                          // TS: env REPLACES the subprocess env
      CLAUDE_CONFIG_DIR: configDir,            // per-tenant config dir
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",    // auto memory loads regardless of settingSources
    },
  },
})) { /* ... */ }
```
Note `settingSources` does **not** control: managed policy settings, `~/.claude.json`, auto memory, claude.ai MCP connectors (see <https://code.claude.com/docs/en/agent-sdk/claude-code-features#what-settingsources-does-not-control>).

### 1.3 Headless CLI (`claude -p`)

Reference: <https://code.claude.com/docs/en/headless>, <https://code.claude.com/docs/en/cli-reference>.

Flags that matter for a factory (verbatim descriptions condensed):

| Flag | Notes |
|---|---|
| `-p`, `--print` | Non-interactive. Exit 0 on success, non-zero on failure. SIGTERM → aborts turn, kills Bash process tree, runs `SessionEnd` hooks, exits **143** |
| `--output-format text\|json\|stream-json` | `json` includes `total_cost_usd` + per-model cost breakdown; `stream-json` is NDJSON |
| `--input-format text\|stream-json` | Enables multi-turn stdin |
| `--include-partial-messages` | Requires `--print` + `--output-format stream-json` |
| `--verbose` | Required together with `stream-json` for streaming examples |
| `--replay-user-messages` | Re-emit stdin user messages on stdout for ack (requires both stream-json formats) |
| `--resume <id\|name>`, `--continue`, `--fork-session`, `--session-id <uuid>`, `--name` | Session control. From v2.1.223 `--resume <id>` searches **all** projects on the machine |
| `--allowedTools` / `--disallowedTools` | Permission rule syntax, e.g. `"Bash(git diff *)"`. Bare deny name *removes the tool from context* |
| `--permission-mode default\|acceptEdits\|plan\|auto\|dontAsk\|bypassPermissions\|manual` | For `-p`, built-in start mode is Manual (`default`) on every plan |
| `--permission-prompt-tool <mcp tool>` | MCP tool answers permission prompts in non-interactive mode |
| `--system-prompt`, `--system-prompt-file` | **Replace** the whole system prompt |
| `--append-system-prompt`, `--append-system-prompt-file` | Append to default |
| `--append-subagent-system-prompt` | Appends to every subagent's system prompt; `-p` only; ≥ v2.1.205 |
| `--exclude-dynamic-system-prompt-sections` | Moves cwd/env/memory/git-flag out of system prompt into first user message → cross-machine prompt-cache reuse |
| `--agents <json>` | Define subagents inline |
| `--mcp-config <file-or-json>`, `--strict-mcp-config` | With `-p`, waits for pending servers up to `MCP_TIMEOUT` (30 s default) |
| `--settings <file-or-json>` | Overrides same keys in settings.json for the session; ≤ 2 MiB |
| `--setting-sources user,project,local` | |
| `--add-dir` | Grants **file access**, not configuration discovery |
| `--max-turns N` | Print mode only; exits with an error at the limit |
| `--max-budget-usd N` | Print mode only; subagent spend counts; ≥ v2.1.217 also stops background subagents |
| `--model`, `--fallback-model a,b,c` | Fallback chain tried in order |
| `--effort low\|medium\|high\|xhigh\|max\|ultracode` | |
| `--json-schema '<schema>'` | With `--output-format json` → `structured_output` field |
| `--bare` | Skips auto-discovery of hooks/skills/plugins/MCP/auto memory/CLAUDE.md. **Does not read OAuth creds or keychain** — needs `ANTHROPIC_API_KEY` or `apiKeyHelper`. "recommended mode for scripted and SDK calls, and will become the default for `-p`" |
| `--forward-subagent-text` | Emit subagent text/thinking as `assistant`/`user` messages with `parent_tool_use_id`; ≥ v2.1.211 (nested subagents ≥ v2.1.219) |
| `--include-hook-events` | Emit hook lifecycle events in the stream |
| `--no-session-persistence` | Print mode only; no resumable transcript |
| `--worktree <name\|#PR\|url>`, `--tmux` | Worktree session |
| `--debug[=cats]`, `--debug-file <path>` | |

**Danger for a factory:** without `--bare`, `claude -p` **runs hooks from a repo's `.claude/settings.json` and connects servers from `.mcp.json` even in an untrusted folder**, because `-p` shows no trust dialog. If you check out untrusted ticket branches, run with `--bare` (or `settingSources: []` + explicit config) — see <https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder>.

### 1.4 Managed Agents (Anthropic-hosted)

Docs: <https://platform.claude.com/docs/en/managed-agents/overview>, <https://platform.claude.com/docs/en/managed-agents/reference>.

- Beta header required on all endpoints: **`managed-agents-2026-04-01`** (memory store endpoints use `agent-memory-2026-07-22`). Enabled by default for API accounts.
- Concepts: **Agent** (model, system prompt, tools, MCP servers, skills) → **Environment** (Anthropic cloud sandbox **or** `self_hosted` sandbox) → **Session** → **Events** (SSE).
- Built-in tools: Bash, file ops (read/write/edit/glob/grep), web search & fetch, MCP servers. Custom tools are round-tripped through `agent.custom_tool_use` → `user.custom_tool_result`.
- Event types (full list in reference): user (`user.message`, `user.interrupt`, `user.custom_tool_result`, `user.tool_confirmation`, `user.define_outcome`, `user.tool_result`), agent (`agent.message`, `agent.thinking`, `agent.tool_use`, `agent.tool_result`, `agent.mcp_tool_use`, `agent.mcp_tool_result`, `agent.custom_tool_use`, `agent.thread_context_compacted`, `agent.thread_message_received/sent`), session (`session.status_running/idle/rescheduled/terminated`, `session.deleted`, `session.updated`, `session.error`, **`session.usage`**, `session.thread_*`), span (**`span.model_request_start` / `span.model_request_end` with `model_usage`**, `span.outcome_evaluation_*`), system (`system.message`), stream-only deltas (`event_start`, `event_delta`).
- Rate limits: **300 create req/min, 1,200 read req/min per org** (plus normal Messages API tier limits).
- **Not eligible for Zero Data Retention or a HIPAA BAA** — sessions store conversation history, sandbox state, and outputs server-side. You can delete sessions/files via API.
- Self-hosted sandbox worker CLI: `ant beta:worker --environment-id --environment-key --workdir --on-work --unrestricted-paths --max-idle --log-format`.

**Verdict for this factory:** Managed Agents gives you a good hosted event stream (`span.model_request_end` carries `model_usage`) but takes away exactly what you want: your own git worktrees on your own disk, your own hooks, your own compiled-prompt capture, `/code-review` and skills-as-you-ship-them, and ZDR eligibility. Use it only if you later want a hosted fallback pool.

### 1.5 Auth: subscription vs API key

Precedence (from <https://code.claude.com/docs/en/authentication#authentication-precedence>):
1. Cloud provider (`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`)
2. `ANTHROPIC_AUTH_TOKEN` (Bearer)
3. `ANTHROPIC_API_KEY` (`X-Api-Key`) — in `-p`, "the key is always used when present"
4. `apiKeyHelper` script (refresh after 5 min or on 401; `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`)
5. `CLAUDE_CODE_OAUTH_TOKEN` — a **one-year** token from `claude setup-token`
6. Anthropic profile / Workload Identity Federation credentials
7. `/login` subscription OAuth

`claude setup-token` details: opens the browser flow, prints the token, saves nothing. "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. **It can only make model requests**, so it can't establish Remote Control sessions or fetch claude.ai connectors." **Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`.**

⚠️ **Licensing caveat for a product**, from the Agent SDK overview:
> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

For an **internal** factory used by your own team this is a business question, not a technical one — I could not find a doc that explicitly blesses or forbids driving your own seats' subscription quota from an internal automation. Treat API-key (Console) billing as the default and confirm subscription-quota automation with Anthropic if you want it.

Practical differences:
- Subscription/OAuth: plan rate-limit windows exist and are readable via the experimental `usage_EXPERIMENTAL_...` control request; `rate_limits_available` is **false** for API key, Bedrock, Vertex.
- API key: per-org tier limits (below), Usage & Cost API for authoritative billing, ZDR possible.
- Prompt cache TTL: **1 hour automatically for Claude subscription users within included usage**; API key / Bedrock / Vertex / Foundry get 5 minutes unless you set `ENABLE_PROMPT_CACHING_1H=1` (higher write cost).

### 1.6 Concurrency & rate limits (API key path)

From <https://platform.claude.com/docs/en/api/rate-limits>:
- Limits are **per organization, per model class**: RPM / ITPM (input tokens/min) / OTPM (output tokens/min). **There is no documented "concurrent requests" limit** — concurrency is bounded indirectly by RPM/ITPM/OTPM, plus "acceleration limits" if traffic spikes sharply.
- Example standard limits: Build tier Opus 5 = 5,000 RPM / 5,000,000 ITPM / 1,000,000 OTPM; Sonnet 5 same; Fable 5 = 2,000 / 1,500,000 / 300,000. Scale tier doubles-to-2× those (Opus 5: 10,000 / 10M / 2M).
- **`cache_read_input_tokens` do NOT count toward ITPM** on current models (Haiku 3.5 excepted). "With a 2,000,000 ITPM limit and an 80% cache hit rate, you could effectively process 10,000,000 total input tokens per minute." → prompt caching is the primary lever for factory throughput.
- 429 responses carry `retry-after`; headers `anthropic-ratelimit-{requests,input-tokens,output-tokens}-{limit,remaining,reset}`.
- Spend caps per tier: Start $500/mo, Build $1,000/mo, Scale $200,000/mo; per-workspace limits configurable.

---

## 2. Observing everything

### 2.1 The SDK message stream (`SDKMessage`)

Ground truth from `sdk.d.ts@0.3.235`. The union is far bigger than the docs' "five core types":

```ts
export declare type SDKMessage =
  | SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay | SDKResultMessage
  | SDKSystemMessage | SDKPartialAssistantMessage | SDKCompactBoundaryMessage
  | SDKStatusMessage | SDKAPIRetryMessage | SDKControlRequestProgressMessage
  | SDKModelRefusalFallbackMessage | SDKModelRefusalNoFallbackMessage
  | SDKLocalCommandOutputMessage | SDKHookStartedMessage | SDKHookProgressMessage
  | SDKHookResponseMessage | SDKPluginInstallMessage | SDKToolProgressMessage
  | SDKAuthStatusMessage | SDKTaskNotificationMessage | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage | SDKTaskProgressMessage | SDKBackgroundTasksChangedMessage
  | SDKThinkingTokensMessage | SDKSessionStateChangedMessage | SDKWorkerShuttingDownMessage
  | SDKCommandsChangedMessage | SDKNotificationMessage | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage | SDKMemoryRecallMessage | SDKRateLimitEvent
  | SDKElicitationCompleteMessage | SDKPermissionDeniedMessage | SDKPromptSuggestionMessage
  | SDKMirrorErrorMessage | SDKInformationalMessage | SDKConversationResetMessage;
```

#### `system` / `init` (`SDKSystemMessage`)
Emitted at the start of each turn, normally before everything else:
```ts
{
  type: 'system'; subtype: 'init';
  agents?: string[]; apiKeySource: ApiKeySource; betas?: string[];
  claude_code_version: string; cwd: string; tools: string[];
  mcp_servers: { name: string; status: string }[];
  model: string; permissionMode: PermissionMode;
  slash_commands: string[]; terminal_slash_commands?: string[];
  output_style: string; skills: string[];
  plugins: { name: string; path: string; version?: string }[];
  effort?: 'low'|'medium'|'high'|'xhigh'|'max'|null;
  capabilities?: string[];           // feature-detect, e.g. 'interrupt_receipt_v1'
  uuid: UUID; session_id: string;
}
```
`apiKeySource` values: `'ANTHROPIC_API_KEY' | 'apiKeyHelper' | '/login managed key' | 'none'` (plus legacy members).
The CLI stream additionally exposes `plugin_errors[]` and `mcp_server_errors[]` on `system/init` — use them as **CI gates**: "The key is omitted when there are no errors, so a CI gate can fail on a non-empty array" (<https://code.claude.com/docs/en/headless#fail-ci-when-a-plugin-or-mcp-server-doesn-t-load>).

#### `assistant` (`SDKAssistantMessage`)
```ts
{
  type: 'assistant';
  message: BetaMessage;              // id, model, content[], stop_reason, usage
  parent_tool_use_id: string | null; // non-null ⇒ produced inside a subagent
  error?: SDKAssistantMessageError;  // 'rate_limit' | 'overloaded' | 'billing_error' | ...
  uuid: UUID; session_id: string; request_id?: string;
  subagent_type?: string; task_description?: string;
  timestamp?: string;                // display only; do not order by it
  supersedes?: UUID[];               // refusal-fallback retraction
  aborted?: true;
  context_usage?: SDKContextUsage;   // structured /context report
}
```

#### `user` (`SDKUserMessage`)
Carries tool results back. **`tool_use_result?: unknown`** is the structured tool output ("the tool's full Output object, not the string content sent to the model… For the Agent/Task tool the completed shape is the subagent's final report… plus run totals — render from it instead of parsing the tool_result text").

#### `stream_event` (`SDKPartialAssistantMessage`), only with `includePartialMessages`
```ts
{ type: 'stream_event'; event: BetaRawMessageStreamEvent; parent_tool_use_id: string|null;
  uuid: UUID; session_id: string; ttft_ms?: number }
```
`message_delta` events carry live `usage` — the doc-recommended way to watch output tokens grow.

#### `result` (`SDKResultSuccess` — verbatim field list)
```ts
{
  type: 'result'; subtype: 'success';
  duration_ms: number; duration_api_ms: number;
  ttft_ms?: number; ttft_stream_ms?: number; time_to_request_ms?: number;
  user_message_uuid?: string; request_sent_wall_ms?: number;
  time_to_request_from_spawn_ms?: number; warm_spare_claimed?: boolean; time_origin_ms?: number;
  is_error: boolean; api_error_status?: number | null;
  num_turns: number; result: string; stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;                 // MAIN AGENT LOOP ONLY
  modelUsage: Record<string, ModelUsage>;  // whole tree incl. subagents + compaction
  permission_denials: SDKPermissionDenial[];   // { tool_name, tool_use_id, tool_input }
  structured_output?: unknown;
  deferred_tool_use?: SDKDeferredToolUse;
  terminal_reason?: TerminalReason;
  uuid: UUID; session_id: string;
}
```
Error variant `SDKResultError` has `subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'` plus `errors: string[]` and the same cost fields.

`ModelUsage` (per model key):
```ts
{ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens,
  webSearchRequests, costUSD, contextWindow, maxOutputTokens,
  canonicalModel?, provider? }   // provider: 'firstParty'|'bedrock'|'vertex'|'foundry'|...
```

**Accounting rules (cost-tracking doc, <https://code.claude.com/docs/en/agent-sdk/cost-tracking>):**
- `usage` **excludes** subagents; `total_cost_usd` and `modelUsage` **include** them. "Use `modelUsage` for whole-tree token accounting; the `usage` field undercounts as soon as nesting occurs."
- Per-step `output_tokens` on assistant messages is a **placeholder** — read output tokens from the result's `usage`/`modelUsage`.
- Parallel tool calls share one `message.id`; deduplicate by ID when summing per-step input tokens.
- In streaming input mode, each turn emits a result; `total_cost_usd`/`modelUsage` are **running totals for the whole call** — read the latest, don't sum. A `/clear` resets them and emits `SDKConversationResetMessage`.
- `total_cost_usd`/`costUSD` are **client-side estimates** from a bundled price table — "Do not bill end users or trigger financial decisions from these fields." Use the Usage & Cost API for billing truth: <https://platform.claude.com/docs/en/build-with-claude/usage-cost-api>.
- Crash → `error_during_execution` with possibly zeroed cost fields; recover from the previous result or by summing assistant `usage`.

#### Observability-relevant system messages (exact shapes)
```ts
SDKToolProgressMessage  { type:'tool_progress'; tool_use_id; tool_name; parent_tool_use_id;
                          elapsed_time_seconds; task_id?; subagent_type?;
                          subagent_retry?: { agent_id; attempt; max_retries; retry_delay_ms;
                                             error_status; error_category } }
SDKAPIRetryMessage      { type:'system'; subtype:'api_retry'; attempt; max_retries;
                          retry_delay_ms; error_status; error }
SDKPermissionDeniedMessage { type:'system'; subtype:'permission_denied'; tool_name; tool_use_id;
                          agent_id?; decision_reason_type?; decision_reason?; message }
SDKCompactBoundaryMessage  { type:'system'; subtype:'compact_boundary';
                          compact_metadata: { trigger:'manual'|'auto'; pre_tokens; post_tokens?;
                                              duration_ms?; preserved_messages? } }
SDKMirrorErrorMessage   { type:'system'; subtype:'mirror_error'; error; key:{projectKey,sessionId,subpath?} }
SDKSessionStateChangedMessage { type:'system'; subtype:'session_state_changed';
                          state:'idle'|'running'|'requires_action' }   // 'idle' = authoritative turn-over
SDKHookStartedMessage   { type:'system'; subtype:'hook_started';  hook_id; hook_name; hook_event }
SDKHookProgressMessage  { ... subtype:'hook_progress';  stdout; stderr; output }
SDKHookResponseMessage  { ... subtype:'hook_response';  output; stdout; stderr; exit_code?;
                          outcome:'success'|'error'|'cancelled' }
SDKToolUseSummaryMessage { type:'tool_use_summary'; summary; preceding_tool_use_ids }
```
Hook lifecycle messages require `includeHookEvents: true` (CLI: `--include-hook-events`); `SessionStart`/`Setup` hook events are always included.

The CLI-only `system/api_retry` and `system/plugin_install` shapes are documented at <https://code.claude.com/docs/en/headless#handle-api-retries>.

### 2.2 Hooks — the real event list and payloads

The full, authoritative list is the exported constant `HOOK_EVENTS` in `sdk.d.ts` (31 events):

`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `DirectoryAdded`, `MessageDisplay`.

(Reference: <https://code.claude.com/docs/en/hooks>. Note: `SubagentStart` **does** exist; there is no `PostToolUseError` — it is `PostToolUseFailure`.)

**Common input fields — `BaseHookInput` (verbatim from sdk.d.ts):**
```ts
{
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id?: string;   // "UUID correlating a user prompt with all subsequent events until the
                        //  next prompt. Same value emitted on OpenTelemetry events as the
                        //  `prompt.id` attribute, so hook output can be joined to OTel events
                        //  at prompt grain."
  permission_mode?: string;
  agent_id?: string;    // present ONLY inside a subagent
  agent_type?: string;  // e.g. "general-purpose", "code-reviewer"
  effort?: { level: string };
}
```
`prompt_id` is your join key across hooks ↔ OTel ↔ your DB. 

**Per-event extras (verified in sdk.d.ts):**
```ts
PreToolUseHookInput        = Base & { hook_event_name:'PreToolUse';  tool_name; tool_input; tool_use_id }
PostToolUseHookInput       = Base & { hook_event_name:'PostToolUse'; tool_name; tool_input; tool_response;
                                      tool_use_id; duration_ms? }   // "Tool execution time in ms.
                                      // Excludes permission-prompt and hook time."
PostToolUseFailureHookInput= Base & { hook_event_name:'PostToolUseFailure'; tool_name; tool_input;
                                      tool_use_id; error }
SubagentStopHookInput      = Base & { hook_event_name:'SubagentStop'; stop_hook_active; agent_id;
                                      agent_transcript_path; agent_type; last_assistant_message?;
                                      background_tasks?; session_crons? }
PostCompactHookInput       = Base & { hook_event_name:'PostCompact'; trigger:'manual'|'auto';
                                      compact_summary }
PermissionRequestHookInput = Base & { hook_event_name:'PermissionRequest'; tool_name; tool_input;
                                      permission_suggestions?: PermissionUpdate[] }
ConfigChangeHookInput      = Base & { hook_event_name:'ConfigChange';
                                      source:'user_settings'|'project_settings'|'local_settings'|
                                             'policy_settings'|'skills'; file_path? }
WorktreeCreateHookInput    = Base & { hook_event_name:'WorktreeCreate'; ... }   // output: { hookEventName:'WorktreeCreate', worktreePath }
WorktreeRemoveHookInput    = Base & { hook_event_name:'WorktreeRemove'; worktree_path }
```
Other event-specific fields per the hooks reference: `UserPromptSubmit.user_input`; `UserPromptExpansion.{command_name,command_input,expanded_prompt}`; `Stop.{last_assistant_message,stop_reason}`; `StopFailure.{error_type,error_message}`; `Notification.{notification_type,notification_data}`; `PermissionDenied.{denial_reason,classifier_verdict}`; `PostToolBatch.tool_uses[]`; `PreCompact/PostCompact.compact_reason`; `SessionEnd.end_reason`; `FileChanged.{file_path,change_type}`; `CwdChanged.{new_cwd,previous_cwd}`; `InstructionsLoaded.{instruction_file_path,load_reason}`; `SubagentStart.{subagent_id,subagent_type,subagent_instructions}`.

**Output / gating semantics:**
- Universal JSON fields: `continue` (false ⇒ stop everything), `stopReason`, `systemMessage`, `additionalContext` (on the events that accept it), `terminalSequence`. `suppressOutput` is accepted but ignored.
- `PreToolUse` → `hookSpecificOutput: { hookEventName, permissionDecision: 'allow'|'deny'|'ask'|'defer', permissionDecisionReason, updatedInput }`. Precedence: **deny > defer > ask > allow**.
- `PostToolUse` → `hookSpecificOutput.additionalContext` (appended to the tool result) and **`updatedToolOutput`** (replace the tool's output before Claude sees it, any tool, both SDKs; `updatedMCPToolOutput` is deprecated).
- `PermissionRequest` → `hookSpecificOutput.decision: 'allow'|'deny'|'ask'` + `decision_reason` (exit 2 is *not* honored here).
- Exit-code semantics for command hooks: **exit 2 blocks** on `PreToolUse`, `UserPromptSubmit`, `UserPromptExpansion`, `PostToolBatch`, `Stop`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `PreCompact`, `ConfigChange`, `Elicitation`, `ElicitationResult`. `WorktreeCreate` blocks on **any** non-zero exit. `PostToolUse`/`PostToolUseFailure` show stderr to Claude (tool already ran).
- Hooks run **before** every other permission step and a hook `deny` applies even in `bypassPermissions` — the only way to gate *every* tool call (`canUseTool` is skipped for auto-approved tools).
- **Async hooks**: return an async output and the agent continues immediately without waiting (use for webhook/DB writes that must not add latency). Catch your own errors — "an unhandled exception can interrupt the agent."
- Registration in code (TS):
```ts
import { query, type HookCallback, type PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
const audit: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  await recordToolStart(input);             // your Postgres write
  return {};
};
query({ prompt, options: { hooks: { PreToolUse: [{ matcher: "Bash|Edit|Write", hooks: [audit], timeout: 30 }] } } });
```
`HookCallbackMatcher = { matcher?: string; hooks: HookCallback[]; timeout?: number }`.
- Filesystem hooks (`settings.json`) support types `command`, `http` (POST to an endpoint), `mcp_tool`, `prompt`, `agent` — the `http` type is a zero-code way to fan events into your API.

### 2.3 OpenTelemetry export

Docs: <https://code.claude.com/docs/en/monitoring-usage> and <https://code.claude.com/docs/en/agent-sdk/observability>.

The SDK emits no telemetry of its own: it **passes env vars to the CLI subprocess**, which exports directly to your collector.

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1      # required for TRACES only
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp                 # otlp|prometheus|console|none
OTEL_LOGS_EXPORTER=otlp                    # otlp|console|none
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf  # grpc|http/json|http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer …"
OTEL_METRIC_EXPORT_INTERVAL=60000          # default 60000 ms
OTEL_LOGS_EXPORT_INTERVAL=5000             # default 5000 ms
OTEL_TRACES_EXPORT_INTERVAL=1000           # lower for short-lived calls
OTEL_SERVICE_NAME=factory-builder
OTEL_RESOURCE_ATTRIBUTES="enduser.id=…,tenant.id=…,service.version=1.4.0"
CLAUDE_CODE_OTEL_DIAG_STDERR=1             # surface exporter errors on stderr (≥ v2.1.179)
```
⚠️ **Never set `console` as an exporter under the SDK** — stdout is the SDK's message channel.

**Metrics:** `claude_code.session.count`, `claude_code.lines_of_code.count`, `claude_code.pull_request.count`, `claude_code.commit.count`, `claude_code.cost.usage` (USD), `claude_code.token.usage`, `claude_code.code_edit_tool.decision`, `claude_code.active_time.total` (s).

**Log events:** `claude_code.user_prompt`, `claude_code.assistant_response` (≥ v2.1.193), `claude_code.api_request`, `claude_code.api_error`, `claude_code.api_refusal`, `claude_code.tool_result`, `claude_code.tool_decision`, `claude_code.api_request_body`, `claude_code.api_response_body`, `claude_code.permission_mode_changed`, `claude_code.auth`, `claude_code.mcp_server_connection`, `claude_code.plugin_loaded`.

**Traces (beta) span hierarchy:**
```
claude_code.interaction (root, one turn)
├── claude_code.llm_request          (model, latency, token counts)
├── claude_code.hook                 (needs ENABLE_BETA_TRACING_DETAILED=1 + BETA_TRACING_ENDPOINT)
└── claude_code.tool
    ├── claude_code.tool.blocked_on_user   (permission wait!)
    └── claude_code.tool.execution
```
Subagent `llm_request`/`tool` spans nest under the parent's `claude_code.tool` span — the delegation chain is one trace.

**Attributes:** all signals carry `session.id`, `user.id`, `organization.id`, `user.account_uuid`, `user.email`, `terminal.type`; events add **`prompt.id`** (the same UUID as `BaseHookInput.prompt_id`), `message.uuid`, `client_request_id`.

**Trace context linkage:** "The SDK automatically propagates W3C trace context into the CLI subprocess… injects `TRACEPARENT` and `TRACESTATE`… the CLI's `claude_code.interaction` span becomes a child of your span." It also forwards `TRACEPARENT` to every Bash/PowerShell command it runs. Set `TRACEPARENT` explicitly in `options.env` to pin a parent.

**Content opt-ins (off by default):**
| Variable | Adds |
|---|---|
| `OTEL_LOG_USER_PROMPTS=1` | Prompt text on `claude_code.user_prompt` and the `interaction` span |
| `OTEL_LOG_TOOL_DETAILS=1` | Tool input arguments on `claude_code.tool_result` |
| `OTEL_LOG_TOOL_CONTENT=1` | Full tool input+output bodies as span events on `claude_code.tool` (60 KB default, `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`); requires tracing |
| `OTEL_LOG_RAW_API_BODIES=1` or `file:<dir>` | **Full Messages API request & response JSON** as `claude_code.api_request_body` / `claude_code.api_response_body`. `1` = inline, truncated at 60 KB; `file:<dir>` = untruncated on disk with a `body_ref` path in the event. "Bodies include the entire conversation history and have extended-thinking content redacted." |

### 2.4 Capturing the *compiled / effective* system prompt

There is **no API that returns "the system prompt Claude Code built."** Your options, best to worst:

1. **`OTEL_LOG_RAW_API_BODIES=file:/var/log/claude-bodies`** → every `claude_code.api_request_body` event names a file containing the *actual* request: `system` blocks, tool definitions, and the full message history. This is the ground truth for "what prompt did this phase actually send," and the `file:` form avoids the 60 KB truncation. Cost: those files contain the entire conversation — treat as sensitive, retain deliberately.
2. **Make the prompt deterministic instead of observing it.** Use `systemPrompt: { type:'preset', preset:'claude_code', append: <your phase prompt>, excludeDynamicSections: true }` (or `--append-system-prompt` + `--exclude-dynamic-system-prompt-sections`). Then the only variable parts are your `append` text and CLAUDE.md — both of which you already have in your DB. `excludeDynamicSections` moves cwd/git/platform/shell/OS/auto-memory-paths into the first user message, so the system prompt is byte-identical across workers (and prompt-cacheable cross-machine).
3. **Fully custom prompt**: `systemPrompt: "<string>"` or `string[]` with the exported `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker splitting the cacheable static prefix from the dynamic suffix. Then you *own* 100% of the system prompt and can store it verbatim. You lose Claude Code's tool guidance and safety instructions ("Default tools: Lost (unless included)", "Built-in safety: Must be added").
4. **`Query.getContextUsage()`** returns "a breakdown of current context window usage by category (system prompt, tools, messages, MCP tools, memory files, etc.)" — token counts per category, **not** the text.
5. CLAUDE.md is **not** in the system prompt in the SDK: "The SDK injects their content into the conversation and leaves the system prompt untouched." (It *is* in `-p` sessions' context, but via the conversation.)

**SDK default vs CLI default (gotcha):** with no `systemPrompt`, the SDK uses "a minimal prompt that covers tool calling but omits Claude Code's coding guidelines, response style, and project context. **This differs from `claude -p`, which uses the full Claude Code prompt by default.**" If you port CLI prompts to the SDK, set the preset explicitly.

### 2.5 Transcript JSONL files

- Path: `~/.claude/projects/<project>/<session-id>.jsonl` where `<project>` is the absolute cwd with every non-alphanumeric char replaced by `-` (`/Users/me/proj` → `-Users-me-proj`). Names over 200 chars are truncated to 200 + a hash of the full path. `CLAUDE_CONFIG_DIR` relocates the root.
- Subagent transcripts live separately; `SubagentStopHookInput.agent_transcript_path` gives you the path directly, and in a `SessionStore` they arrive under `subpath: "subagents/agent-<id>"`.
- Retention: `cleanupPeriodDays` (default 30). `--no-session-persistence` / `CLAUDE_CODE_SKIP_PROMPT_HISTORY` suppress writes; `persistSession: false` in TS.
- **Format warning (verbatim):** "Each line is a JSON object for a message, tool use, or metadata entry. **The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release.**"

### 2.6 `SessionStore` — the supported "transcript → Postgres" path

<https://code.claude.com/docs/en/agent-sdk/session-storage>

```ts
type SessionKey = { projectKey: string; sessionId: string; subpath?: string };
type SessionStore = {
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;   // required
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;            // required
  listSessions?(projectKey: string): Promise<Array<{sessionId: string; mtime: number}>>;
  listSessionSummaries?(projectKey: string): Promise<SessionSummaryEntry[]>;
  delete?(key: SessionKey): Promise<void>;
  listSubkeys?(key: {projectKey: string; sessionId: string}): Promise<string[]>;
};
```
- Dual-write: the subprocess writes local JSONL first, then the SDK forwards each batch to `append()` (~100 ms cadence during active turns). A run **resumed from the store** deletes its local copy at the end, so the store is then the only durable copy.
- Deduplicate by `entry.uuid` — retries can re-deliver. Failures: 3 attempts, then the batch is dropped and a `{type:'system', subtype:'mirror_error'}` message is emitted (alert on it).
- Conflicts: `persistSession: false` and `enableFileCheckpointing` both throw at startup when combined with a store.
- Reference adapters (S3 / Redis / **Postgres** — "one row per entry in a `jsonb` table, ordered by `BIGSERIAL`") + a conformance suite: <https://github.com/anthropics/claude-agent-sdk-typescript/tree/main/examples/session-stores>
- `getSessionMessages({ sessionStore })` returns the **post-compaction** chain; call `store.load(key)` for raw history.

---

## 3. Interactive human-in-the-loop from a custom web UI

### 3.1 Streaming input mode (required for interactivity)

<https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode>. Pass an `AsyncIterable<SDKUserMessage>` as `prompt`:

```ts
async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
  yield { type: "user", message: { role: "user", content: "Analyze this codebase" },
          parent_tool_use_id: null };
  await waitForWebUiInput();
  yield { type: "user",
          message: { role: "user", content: [
            { type: "text", text: "Review this screenshot" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }]},
          parent_tool_use_id: null };
}
const q = query({ prompt: generateMessages(), options: { includePartialMessages: true } });
```
Single-message mode does **not** support image attachments, dynamic queueing, real-time interruption, or natural multi-turn.
Alternatively use the `Query` handle: `q.streamInput(stream)` to push turns into a live session.

**TS generator gotcha:** if your generator throws, the stream ends with `Claude Code process aborted by user` rather than the real error. In Python, a generator exception is logged at debug level and the session **stalls silently**.

### 3.2 `canUseTool` — exact signature (from sdk.d.ts)

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];  // ready-made rules for "always allow"
    blockedPath?: string;
    decisionReason?: string;
    title?: string;        // "Claude wants to read foo.txt" — render this
    displayName?: string;  // "Read file" — button label
    description?: string;
    toolUseID: string;
    agentID?: string;      // set when the call came from a subagent
    requestId: string;     // control_request envelope id; echo for out-of-band responses
    matchedAskRule?: { source: string; toolName: string; ruleContent?: string };
  }
) => Promise<PermissionResult | null>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[]; toolUseID?: string; decisionClassification?: … }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string; … };
```
- "The callback can stay pending indefinitely. Execution remains paused until your callback returns" — perfect for a web UI that shows an approve/deny card.
- **Auto-approved tools never reach `canUseTool`.** Anything matched by an allow rule, `acceptEdits`, or `bypassPermissions` skips it. TS emits a process warning with code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` when your config shadows the callback. For checks that must run on *every* call, use a `PreToolUse` hook.
- Python quirk: `can_use_tool` requires streaming mode, and a finite generator closes the input stream before the callback can fire unless a hook or in-process MCP server keeps it open — the docs' workaround is a dummy `PreToolUse` hook returning `{"continue_": True}`.
- Evaluation order (<https://code.claude.com/docs/en/agent-sdk/permissions>): hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool`.

### 3.3 Long-lived approvals: the `defer` decision

For a factory where a human may take hours to approve, the docs give an explicit escape hatch: a `PreToolUse` hook returning `hookSpecificOutput.permissionDecision: "defer"` **ends the query so the process can exit and resume later from the persisted session** (<https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later>; the result message carries `deferred_tool_use`). `updatedInput` is ignored with `defer`.

### 3.4 `AskUserQuestion`

It surfaces **through `canUseTool` with `toolName === "AskUserQuestion"`** (not as a separate message type). Input:
```json
{ "questions": [ { "question": "How should I format the output?", "header": "Format",
                   "options": [ {"label":"Summary","description":"Brief overview"},
                                {"label":"Detailed","description":"Full explanation"} ],
                   "multiSelect": false } ] }
```
Answer by allowing with a rewritten input:
```ts
return { behavior: "allow",
         updatedInput: { questions: input.questions,
                         answers: { "How should I format the output?": "Summary",
                                    "Which sections should I include?": "Introduction, Conclusion" },
                         // optional: response: "<freeform reply instead of answering>"
                       } };
```
- Keys are the **question text**, values are the option **`label`** (array or `", "`-joined for `multiSelect`). Free text is allowed as the value.
- Limits: 1–4 questions, 2–4 options each. **Not available in subagents spawned via the Agent tool.**
- If you pass a `tools` allowlist, include `"AskUserQuestion"` explicitly.
- For a web UI, set `toolConfig: { askUserQuestion: { previewFormat: "html" } }` → each option may carry a `preview` HTML fragment (the SDK rejects `<script>`, `<style>`, `<!DOCTYPE>` before your callback runs). Default is no previews.
- Behaviour in `dontAsk` mode: `AskUserQuestion` is **denied**, never asked.

### 3.5 Pause / resume / fork

- Capture `session_id` from the `result` message (or, in TS, from `system/init` — needed to learn a fork's new id).
- `resume: <id>`, `forkSession: true`, `continue: true`, plus `resumeSessionAt` / `resumeDropsTurn` (rewind to a specific chain-entry UUID — typically an `SDKAssistantMessage.uuid`), `sessionId` (pin the id yourself), `persistSession`, `title`.
- Cross-host resume needs a `sessionStore` (lookup key derives from cwd — resume from a **matching cwd**) or you must move the JSONL file.
- Mid-session control on the `Query` handle: `interrupt()` (returns an interrupt receipt with `still_queued` uuids when `capabilities` includes `interrupt_receipt_v1`), `setPermissionMode()`, `setModel()`, `applyFlagSettings()`, `setMcpServers()`, `stopTask(taskId)`, `backgroundTasks(toolUseId?)`, `rewindFiles(userMessageId, {dryRun})` (needs `enableFileCheckpointing`), `getContextUsage()`, `supportedCommands()/Models()/Agents()`, `mcpServerStatus()`, `readFile(path)`, `reloadPlugins()/reloadSkills()`, `close()`.
- `startup({ options })` pre-warms a CLI subprocess before traffic arrives (TS only).

### 3.6 Streaming partial text

`includePartialMessages: true` → `stream_event` messages carrying raw `BetaRawMessageStreamEvent`s. Filter deltas for the web UI:
```bash
claude -p "…" --output-format stream-json --verbose --include-partial-messages | \
  jq -rj 'select(.type=="stream_event" and .event.delta.type?=="text_delta") | .event.delta.text'
```

---

## 4. Reusable building blocks

### 4.1 Skills, settings sources, plugins

- Skills are **filesystem-only**: `.claude/skills/<name>/SKILL.md`. "The SDK does not have a programmatic API for registering skills."
- Discovery is via `settingSources`; the `skills` option (`"all" | string[] | []`) selects which are enabled. Setting `skills` auto-adds the `Skill` tool to `allowedTools` (include `"Skill"` if you also pass an explicit `tools` array).
- `settingSources` (`'user'|'project'|'local'`); omitting it = `["user","project","local"]` (same as the CLI); `[]` = nothing from the filesystem.
  - `project` → project CLAUDE.md, `.claude/rules/*.md`, project skills, project hooks, project `settings.json` (`settings.json`/hooks only from `<cwd>/.claude/`, no parent fallback).
  - `user` → `~/.claude/` equivalents. `local` → `CLAUDE.local.md`, `.claude/settings.local.json`.
- Plugins in the SDK: `plugins: SdkPluginConfig[]` where `{ type: 'local'; path: string; skipMcpDiscovery?: boolean }` — **local paths only**. CLI has `--plugin-dir` and `--plugin-url` (zip).

### 4.2 Subagents (`agents` option / `.claude/agents`)

`AgentDefinition` (sdk.d.ts): `description` (req), `prompt` (req), `tools?`, `disallowedTools?`, `model?` (`'fable'|'opus'|'sonnet'|'haiku'|'inherit'|<full id>`), `mcpServers?`, `skills?`, `initialPrompt?`, `maxTurns?`, `background?`, `memory?` (`'user'|'project'|'local'`), `effort?`, `permissionMode?`, `observer?`, `observerMessage?`, `criticalSystemReminder_EXPERIMENTAL?`.

- Include `"Agent"` in `allowedTools` or every delegation hits your permission callback.
- Since v2.1.198 **subagents run in the background by default**; Claude sets `run_in_background: false` when it needs the result. `background: true` forces it.
- Detect: `tool_use` blocks named `"Agent"` (older: `"Task"`); messages inside a subagent carry `parent_tool_use_id`. `--forward-subagent-text` / `forwardSubagentText` also emits their text and thinking.
- Resume a subagent: the Agent tool result text contains `agentId: <id>`; resume the *session* and mention the agent id in the prompt.
- **Caps (all verified):**
  | Limit | Set with | Default |
  |---|---|---|
  | Nesting depth | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | 3 (set `1` to stop subagents spawning their own) |
  | Concurrency | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | 20; refusals return `Concurrent subagent limit reached` |
  | Spend | `maxBudgetUsd` / `max_budget_usd` | none; at the cap: `Budget limit reached`, background subagents stopped, result subtype `error_max_budget_usd` |
- `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` removes the built-in `general-purpose` agent.
- Opus 5 "delegates to subagents more readily" — the `claude_code` preset adds a restraint line automatically; a custom system prompt does not.
- For dozens-to-hundreds of agents, the docs point to the **`Workflow` tool** (TS SDK ≥ 0.3.149; add `"Workflow"` to `allowedTools`): <https://code.claude.com/docs/en/workflows>.

### 4.3 Git worktree isolation

<https://code.claude.com/docs/en/worktrees>

- CLI: `claude --worktree <name>` (or `-w`), `claude --worktree "#1234"` / PR URL. Default location `.claude/worktrees/<name>/`, branch `worktree-<name>`.
- Subagent isolation: `isolation: worktree` in a `.claude/agents/<name>.md` frontmatter. (⚠️ There is **no `isolation` field on the SDK's `AgentDefinition`** — verified against sdk.d.ts. Programmatic agents can't set it; use a filesystem agent file, or give each phase its own `cwd`.)
- Claude can enter one itself via the **`EnterWorktree`** tool (and `ExitWorktree`). Entering a path outside `.claude/worktrees/` always prompts (only `bypassPermissions` skips it).
- Enforcement while isolated: blocks edits targeting the main checkout; blocks Bash/PowerShell/Monitor commands whose cwd resolves into the main checkout; blocks git redirects (`git -C`, `--git-dir`, `GIT_DIR`, `GIT_WORK_TREE`, `cd` then git); blocks commands it can't statically verify (brace expansion, unquoted heredocs) — "You can't turn this check off."
- Settings block (`worktree` in settings.json): `baseRef: 'fresh'|'head'`, symlink dirs (e.g. `node_modules`), sparse-checkout include dirs, `bgIsolation: 'worktree'|'none'`.
- `.worktreeinclude` (gitignore syntax) copies gitignored files such as `.env` into every new worktree.
- Hooks `WorktreeCreate` (any non-zero exit blocks; stdout/`worktreePath` returns the directory) and `WorktreeRemove` let you replace git entirely.
- **`-p` runs never clean up their worktrees** and leave the creation lock in place until a later stale-lock sweep. Your factory must run `git worktree remove` (and `git worktree unlock` if needed) itself.
- Shared with the main checkout: the `.git` dir, project-scope plugins, and saved permission approvals (`.claude/settings.local.json` of the main checkout).

### 4.4 Hooks as gates

Use `PreToolUse` (exit 2 / `permissionDecision: "deny"`) to block; `PostToolBatch`, `Stop`, `SubagentStop`, `TaskCompleted` (exit 2 / `continue: false`) to refuse "done" until your CI gate passes. Hook denies apply even under `bypassPermissions`. Filesystem hook types include `http` (POST to your endpoint), `prompt` (LLM judge) and `agent` (spawns a verifier agent) — a cheap way to implement "reviewer must pass before the builder may stop."

### 4.5 Sandboxing

<https://code.claude.com/docs/en/sandboxing>, settings keys under `sandbox`:
`enabled`, `autoAllowBashIfSandboxed` (default **true**), `allowUnsandboxedCommands` (set `false` = "Strict sandbox mode": the `dangerouslyDisableSandbox` escape hatch is ignored), `excludedCommands[]`, `network.allowedDomains[]` / denied domains / `allowManagedDomainsOnly`, `filesystem.{allow,denyWrite,denyRead,allowRead,disabled}`, `credentials.files[{path,mode:'deny'|'mask'}]`, `credentials.envVars[{name,mode}]`, `allowAllUnixSockets`, macOS Apple-Events toggle.
- macOS uses Seatbelt (nothing to install); Linux/WSL2 needs `socat` + the optional seccomp filter from **`npm install -g @anthropic-ai/sandbox-runtime`**. Native Windows is unsupported (run inside WSL2).
- SDK option: `sandbox?: SandboxSettings` on `Options`.
- Git writes into the shared `.git` are allowed from inside a worktree with the sandbox on.
- For stronger isolation the docs recommend containers: <https://code.claude.com/docs/en/devcontainer>, <https://code.claude.com/docs/en/sandbox-environments>, <https://code.claude.com/docs/en/agent-sdk/secure-deployment> (isolation technologies: Docker, gVisor, Firecracker), plus sandbox providers (Modal, Cloudflare Sandboxes, Daytona, E2B, Fly Machines, Vercel Sandbox).
- Also useful: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` strips Anthropic/cloud credentials from all subprocesses regardless of sandboxing.

### 4.6 Structured outputs

```ts
options: { outputFormat: { type: "json_schema", schema } }   // CLI: --json-schema '<schema>'
// → message.type === "result" && message.subtype === "success" && message.structured_output
```
- JSON Schema **draft-07** (Zod: `z.toJSONSchema(S, { target: "draft-7" })`; Pydantic: `.model_json_schema()`).
- Invalid schema fails the run at startup (≥ v2.1.205; previously silently ignored). `format` is an accepted annotation, not enforced.
- Failure subtype `error_max_structured_output_retries`; also possible: `success` **with no** `structured_output` — treat as failure.

### 4.7 `/code-review` and ultrareview

<https://code.claude.com/docs/en/code-review>, <https://code.claude.com/docs/en/ultrareview>

- `/code-review [effort] [target] [--fix] [--comment] [--post]` — reviews branch commits ahead of upstream + uncommitted changes; target can be a path, PR number, branch, or `main...feature`. Effort `low|medium` = fewer, high-confidence findings; `high|max` = broader coverage.
- **Headless: yes.** "It runs in the foreground instead in cases like these: … You run it in non-interactive mode, with the `-p` flag or the Agent SDK; **Claude Code waits for the review and includes the findings in the response**" — so `claude -p '/code-review high --fix'` works and returns findings as text (`ReportFindings` structured list only in host apps that request it).
- `REVIEW.md` at repo root is injected into **every** review agent's system prompt as highest priority (not read by the local `/code-review`, only by the GitHub Code Review service — note this asymmetry: "The review follows your `CLAUDE.md` like any Claude Code session, but it doesn't read `REVIEW.md`").
- Governance: `{"skillOverrides": {"code-review": "user-invocable-only"}}` stops Claude and scheduled tasks from launching it on their own.
- `--fix` from a **background** review edits outside checkpoints (`/rewind` won't undo them; use git).
- **Ultrareview** = `/code-review ultra`: a fleet of reviewer agents in an Anthropic cloud sandbox with independent verification of each finding; 5–10 min; requires **claude.ai auth** (not available on Bedrock/Vertex/Foundry, or with ZDR); billed as **usage credits**, ~$5–25/review after 3 free runs (Pro/Max only; Team/Enterprise none). Diff limits ~500 files / 8,000 lines.
- Non-interactive: **`claude ultrareview [PR#|base-branch]`** blocks until findings arrive and prints them to stdout; flags `--json` (raw `bugs.json`), `--timeout <minutes>` (default 30), `--post` / `--no-post`. Exit 0 = completed (with or without findings), 1 = launch/session error or timeout, 130 = interrupted. `claude -p '/code-review ultra'` only *launches* and prints a tracking link, and refuses when the run would bill usage credits.

### 4.8 Agent Teams — **not usable headlessly**

<https://code.claude.com/docs/en/agent-teams>. Experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Multiple full Claude Code sessions with a shared task list (`~/.claude/tasks/{team}/`) and mailboxes (`~/.claude/teams/{team}/inboxes/{agent}.json`), messaging via `SendMessage`.

> "Spawning teammates also requires an interactive session. **In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates**, and a subagent that Claude names runs as an ordinary subagent even with agent teams enabled."

Also: "Agent teams are a CLI feature… Not directly configured via SDK options." → **For the factory, use subagents + your own orchestration, not Agent Teams.** (Related: cross-session messaging, <https://code.claude.com/docs/en/cross-session-messaging>.)

### 4.9 Model selection, fallback, caching

- `model` / `--model` (alias `sonnet|opus|haiku|fable` or full id); `fallbackModel` / `--fallback-model a,b,c` (comma list tried in order) or the `fallbackModel` setting.
- `effort: 'low'|'medium'|'high'|'xhigh'|'max'` per session and per `AgentDefinition`. `thinking: {type:'adaptive'|'disabled'|'enabled', budget_tokens}` is separate from effort.
- Subagent model default env var: `CLAUDE_CODE_SUBAGENT_MODEL`.
- ⚠️ `ANTHROPIC_MODEL` is honored by the CLI but a fleet should pin `model` explicitly per phase.
- Caching: automatic; maximize hits with `excludeDynamicSections` (identical system prompt across workers) and by keeping the phase prompt stable. `ENABLE_PROMPT_CACHING_1H=1` for a 1-hour write TTL on API-key/Bedrock/Vertex/Foundry (higher write cost).

---

## 5. Recommended architecture

### 5.1 Shape

```
web UI (React)  ──WS/SSE──►  factory-api (Node)  ──►  Postgres
                                   │  enqueue
                                   ▼
                            job queue (pg-boss / Redis)
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             worker pod #1                    worker pod #N        (K8s Deployment)
             Node process                     …
               ├─ query() ⇒ claude CLI subprocess  (phase: planner)
               ├─ query() ⇒ claude CLI subprocess  (phase: builder)
               └─ …                                  each cwd = its own git worktree
                    │
                    ├─ hooks (in-process callbacks) ──► Postgres (tool_calls, gates)
                    ├─ sessionStore.append() ─────────► Postgres (transcript_entries jsonb)
                    ├─ message stream ───────────────► Postgres (messages) + WS to UI
                    └─ OTEL_* env ───────────────────► OTel Collector ──► traces/metrics/logs
                                                          (+ api_request_body → object store)
```

**Why SDK-in-a-worker over spawning the CLI yourself:** identical runtime (the SDK spawns the CLI anyway), but you get typed messages, `canUseTool` (needed for the approve/deny UI and `AskUserQuestion`), in-process hook callbacks (no shell round-trip per tool call), `sessionStore` (the only supported DB mirror), `interrupt()`/`setPermissionMode()` control requests, and `startup()` pre-warm. Choose the **TypeScript** SDK: it has strictly more surface than Python today (`persistSession`, `outputStyle` via `settings`, `startup()`, more hook events, `sessionStore` on all session functions, `spawnClaudeCodeProcess`).

**Why not Managed Agents:** no local git worktrees you control, no hooks, no compiled-prompt capture, no ZDR/BAA. Keep it as a possible burst pool only.

**Why one `query()` per phase (planner/builder/reviewer/documenter)** rather than one long session:
- Each phase gets its own `result` message ⇒ clean per-phase `total_cost_usd` / `modelUsage` / `num_turns` / `duration_ms`.
- Each phase can pin its own `model`, `effort`, `systemPrompt.append`, `allowedTools`, `maxTurns`, `maxBudgetUsd`.
- Handoff is explicit: use `outputFormat` JSON schema so the planner returns a typed plan your DB stores, instead of the reviewer having to read the planner's transcript.
- Where a phase genuinely needs the prior context, `resume: <sessionId>` (+ `forkSession: true` for a speculative retry).

Per-phase option sketch:
```ts
const base = {
  cwd: worktreePath,
  settingSources: ["project"] as const,     // repo CLAUDE.md + repo skills + repo hooks
  systemPrompt: { type: "preset", preset: "claude_code",
                  append: phasePrompt, excludeDynamicSections: true },
  permissionMode: "dontAsk",                // hard deny anything not pre-approved
  includePartialMessages: true,
  includeHookEvents: true,
  maxTurns: 60, maxBudgetUsd: 8,
  env: { ...process.env,
         CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
         CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "5",
         CLAUDE_CODE_ENABLE_TELEMETRY: "1",
         CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
         OTEL_TRACES_EXPORTER: "otlp", OTEL_METRICS_EXPORTER: "otlp", OTEL_LOGS_EXPORTER: "otlp",
         OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
         OTEL_EXPORTER_OTLP_ENDPOINT: collector,
         OTEL_LOG_RAW_API_BODIES: `file:${bodyDir}`,     // compiled prompt capture
         OTEL_RESOURCE_ATTRIBUTES:
           `enduser.id=${encodeURIComponent(userId)},ticket.id=${ticketId},phase=${phase}` },
  sessionStore: pgStore,
  hooks: factoryHooks,
  canUseTool: webUiApproval,
  stderr: (d) => log.debug({ phase, d }),
};
// planner:    { ...base, model: "opus",   effort: "high",  allowedTools: ["Read","Grep","Glob","Agent"],
//               outputFormat: { type: "json_schema", schema: PlanSchema }, permissionMode: "plan" }
// builder:    { ...base, model: "sonnet", effort: "xhigh", allowedTools: ["Read","Edit","Write","Glob","Grep","Bash(npm test*)","Bash(git *)","Agent"] }
// reviewer:   { ...base, model: "opus",   allowedTools: ["Read","Grep","Glob"],
//               outputFormat: { type: "json_schema", schema: FindingsSchema } }
// documenter: { ...base, model: "haiku",  effort: "low",   allowedTools: ["Read","Edit","Write","Glob","Grep"] }
```

### 5.2 Which stream feeds which table

| Table | Fed by | Key fields |
|---|---|---|
| `runs` | your orchestrator | ticket_id, worktree_path, branch, status |
| `phases` | orchestrator + `system/init` + `result` | phase, session_id, model, claude_code_version, tools[], plugins[], mcp_servers[], permissionMode, started_at; on result: `duration_ms`, `duration_api_ms`, `ttft_ms`, `num_turns`, `stop_reason`, `subtype`, `is_error`, `total_cost_usd`, `structured_output` |
| `phase_model_usage` | `result.modelUsage` | model, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, provider |
| `messages` | `assistant` / `user` stream messages | uuid, session_id, parent_tool_use_id, subagent_type, task_description, role, content jsonb, message.id, request_id, `usage` jsonb |
| `deltas` (optional, or straight to WS) | `stream_event` | event jsonb, ttft_ms |
| `tool_calls` | `PreToolUse` hook (insert) + `PostToolUse`/`PostToolUseFailure` hook (update) | tool_use_id (PK), tool_name, tool_input jsonb, agent_id, agent_type, prompt_id, effort.level, started_at, ended_at, **duration_ms**, tool_response jsonb / error, decision (allow/deny/defer), decided_by (hook/rule/mode/classifier/human) |
| `tool_progress` | `tool_progress` messages | tool_use_id, elapsed_time_seconds, subagent_retry jsonb |
| `permission_events` | `canUseTool` + `PermissionRequest`/`PermissionDenied` hooks + `system/permission_denied` + `result.permission_denials` | tool_use_id, title, displayName, decisionReason, human user id, latency to decision |
| `subagents` | `SubagentStart`/`SubagentStop` hooks | agent_id, agent_type, subagent_instructions, agent_transcript_path, last_assistant_message |
| `api_retries` / `errors` | `system/api_retry`, `StopFailure` hook, result error subtypes | attempt, max_retries, retry_delay_ms, error_status, error category |
| `compactions` | `compact_boundary` message + `PreCompact`/`PostCompact` hooks | trigger, pre_tokens, post_tokens, duration_ms, compact_summary |
| `transcript_entries` | **`sessionStore.append()`** | projectKey, session_id, subpath, seq (BIGSERIAL), entry jsonb, uuid (idempotency key) |
| `compiled_prompts` | OTel `claude_code.api_request_body` (`file:` bodies) | prompt.id, session.id, body_ref, sha256, system-prompt text, tool list |
| traces/metrics | OTel collector → your APM | joined on `session.id`, `prompt.id`, `TRACEPARENT` |

**Join keys:** `session_id` (phase), `prompt_id` / OTel `prompt.id` (user turn), `tool_use_id` (tool call), `parent_tool_use_id` / `agent_id` (subagent tree), message `uuid`.

### 5.3 Concrete implementation notes

1. **Two writers per tool call.** `PreToolUse` hook inserts the row (you get `tool_input` *before* execution and can gate it), `PostToolUse` updates it with `tool_response` + `duration_ms`. Return an **async hook output** so DB latency never blocks the agent, and catch every error inside the hook.
2. **Cost:** persist `modelUsage` per phase, never `usage`, and label it "estimate". Reconcile nightly against the Usage & Cost API.
3. **Budget guardrails:** `maxBudgetUsd` per phase + `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` + `maxTurns`. There is no session wall-clock timeout — implement your own with `AbortController` (`options.abortController`) or `q.close()`.
4. **Worktrees:** create them yourself (`git worktree add`) and pass `cwd`, or use `--worktree` on a CLI path. Either way, **you must remove them** — `-p` never cleans up. Copy `.env` etc. via `.worktreeinclude`. Consider `worktree.baseRef: "head"` if phases must build on unpushed work.
5. **Trust:** run each ticket's worktree with `settingSources: ["project"]` **only if you trust the repo**; for untrusted branches use `settingSources: []` + inline `--settings`/`mcpServers`, because `-p`/SDK sessions execute repo `.claude/settings.json` hooks and `.mcp.json` servers with no trust dialog.
6. **Scaling:** pin a session to a pod with consistent hashing on `sessionId` for long-running phases; use the hybrid pattern (ephemeral pod + `sessionStore` hydrate) for phases that idle waiting on a human.
7. **Alert on `mirror_error`** — it means transcript batches were dropped from your DB mirror.
8. **Feature-detect** with `system/init.capabilities` rather than version strings; fail CI on non-empty `plugin_errors` / `mcp_server_errors`.
9. **Turn-complete signal:** the `result` message per turn; `session_state_changed` with `state: 'idle'` is described in the types as the "authoritative turn-over signal" for background agents. A few informational messages (e.g. `prompt_suggestion`) can arrive *after* the result — iterate to completion, don't `break`.
10. **Human approvals that outlive the process:** `canUseTool` can block forever, but for hours-long waits use the `PreToolUse` `defer` decision and resume the persisted session later.

---

## 6. Couldn't verify / uncertain

1. **Subscription (claude.ai) auth for an internal automation fleet.** The SDK overview forbids offering claude.ai login/rate limits in *third-party products* "unless previously approved," and `claude setup-token` explicitly targets CI. I found no doc that says whether running your own team's subscription quota through an internal factory is permitted at scale. Confirm with Anthropic; default to Console API keys.
2. **Exact JSONL transcript schema.** Docs deliberately do not publish it and call it internal/unstable. I did not enumerate field names from a live file. Do not build on it.
3. **`SandboxSettings` field list as seen by the SDK** is `z.infer<...>` in the typings; I read the underlying zod schema keys (`enabled`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `excludedCommands`, `network.allowedDomains`, `filesystem.*`, `credentials.*`) from the same file, but I did not verify the complete nested shape against a runtime instance.
4. **No `isolation` option on the SDK's `AgentDefinition`** — confirmed absent in `sdk.d.ts@0.3.235`; worktree isolation for subagents appears to be filesystem-frontmatter-only (`isolation: worktree`). I could not find an SDK-side equivalent, so if you need it programmatically you must write agent markdown files.
5. **Managed Agents REST paths and request bodies.** The overview and reference give concepts, event types, beta headers and rate limits, but I did not fetch the sessions/quickstart pages, so I have no verified endpoint paths (e.g. `POST /v1/agents`) or field names for create-agent/create-session.
6. **Concurrency ceiling per API key.** Rate-limit docs define RPM/ITPM/OTPM and "acceleration limits" but no documented max concurrent requests. Plan capacity from ITPM/OTPM with cache-hit rate, and expect 429 + `retry-after`.
7. **`claude_code.api_request_body` completeness** — the doc says it contains "Full Anthropic Messages API request … JSON" with extended-thinking content redacted. I did not observe an actual body, so I cannot confirm whether the `system` array is verbatim-complete or partially redacted.
8. **Per-turn `duration_ms` on `PostToolUse`** is typed optional (`duration_ms?`) — presumably absent on older CLI builds. Fall back to timestamping in your hooks.
9. **`/skill-doctor` and `claude plugin eval`** (skill diagnostics / plugin eval harness) are early-access and **not enabled in this session**, so I could not exercise them; they may be relevant later for validating the factory's own skills/plugins, but I have no first-hand output.
10. **OTel span attribute names** (beyond span names) are documented as beta and "may change between releases" — pin your dashboards loosely.

---

## 7. URL index

Agent SDK
- Overview <https://code.claude.com/docs/en/agent-sdk/overview>
- Agent loop <https://code.claude.com/docs/en/agent-sdk/agent-loop>
- TypeScript reference <https://code.claude.com/docs/en/agent-sdk/typescript>
- Python reference <https://code.claude.com/docs/en/agent-sdk/python>
- Sessions <https://code.claude.com/docs/en/agent-sdk/sessions>
- Session storage (SessionStore) <https://code.claude.com/docs/en/agent-sdk/session-storage>
- Hosting <https://code.claude.com/docs/en/agent-sdk/hosting>
- Secure deployment <https://code.claude.com/docs/en/agent-sdk/secure-deployment>
- Observability (OTel) <https://code.claude.com/docs/en/agent-sdk/observability>
- Cost tracking <https://code.claude.com/docs/en/agent-sdk/cost-tracking>
- Hooks <https://code.claude.com/docs/en/agent-sdk/hooks>
- Permissions <https://code.claude.com/docs/en/agent-sdk/permissions>
- Handle approvals & user input <https://code.claude.com/docs/en/agent-sdk/user-input>
- Streaming vs single mode <https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode>
- Streaming output <https://code.claude.com/docs/en/agent-sdk/streaming-output>
- Structured outputs <https://code.claude.com/docs/en/agent-sdk/structured-outputs>
- Subagents <https://code.claude.com/docs/en/agent-sdk/subagents>
- Modifying system prompts <https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>
- Claude Code features / settingSources <https://code.claude.com/docs/en/agent-sdk/claude-code-features>
- Skills in the SDK <https://code.claude.com/docs/en/agent-sdk/skills>
- MCP in the SDK <https://code.claude.com/docs/en/agent-sdk/mcp>
- Custom tools <https://code.claude.com/docs/en/agent-sdk/custom-tools>
- File checkpointing <https://code.claude.com/docs/en/agent-sdk/file-checkpointing>

Claude Code
- Headless mode <https://code.claude.com/docs/en/headless>
- CLI reference <https://code.claude.com/docs/en/cli-reference>
- Hooks reference <https://code.claude.com/docs/en/hooks>
- Monitoring / OpenTelemetry <https://code.claude.com/docs/en/monitoring-usage>
- Sessions & transcripts <https://code.claude.com/docs/en/sessions>
- Worktrees <https://code.claude.com/docs/en/worktrees>
- Subagents <https://code.claude.com/docs/en/sub-agents>
- Agent teams <https://code.claude.com/docs/en/agent-teams>
- Workflows <https://code.claude.com/docs/en/workflows>
- Skills <https://code.claude.com/docs/en/skills>
- Plugins <https://code.claude.com/docs/en/plugins> · reference <https://code.claude.com/docs/en/plugins-reference>
- Settings <https://code.claude.com/docs/en/settings> · Permissions <https://code.claude.com/docs/en/permissions> · Permission modes <https://code.claude.com/docs/en/permission-modes>
- Sandboxing <https://code.claude.com/docs/en/sandboxing> · Sandbox environments <https://code.claude.com/docs/en/sandbox-environments> · Dev container <https://code.claude.com/docs/en/devcontainer>
- Authentication <https://code.claude.com/docs/en/authentication>
- Env vars <https://code.claude.com/docs/en/env-vars>
- Model config <https://code.claude.com/docs/en/model-config>
- Prompt caching <https://code.claude.com/docs/en/prompt-caching>
- Code Review <https://code.claude.com/docs/en/code-review> · Ultrareview <https://code.claude.com/docs/en/ultrareview>
- Costs <https://code.claude.com/docs/en/costs> · Analytics <https://code.claude.com/docs/en/analytics>

Claude API / platform
- Managed Agents overview <https://platform.claude.com/docs/en/managed-agents/overview>
- Managed Agents reference (events, rate limits) <https://platform.claude.com/docs/en/managed-agents/reference>
- Managed Agents sessions <https://platform.claude.com/docs/en/managed-agents/sessions>
- Self-hosted sandboxes <https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes>
- Rate limits <https://platform.claude.com/docs/en/api/rate-limits>
- Usage & Cost API <https://platform.claude.com/docs/en/build-with-claude/usage-cost-api>
- Prompt caching <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Structured outputs <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>

GitHub
- TS SDK <https://github.com/anthropics/claude-agent-sdk-typescript> (CHANGELOG.md, `examples/session-stores/{s3,redis,postgres}`, `examples/session-stores/shared/conformance.ts`)
- Python SDK <https://github.com/anthropics/claude-agent-sdk-python>
- Demos <https://github.com/anthropics/claude-agent-sdk-demos>
- Hosting cookbook <https://github.com/anthropics/claude-cookbooks/tree/main/claude_agent_sdk/hosting>
