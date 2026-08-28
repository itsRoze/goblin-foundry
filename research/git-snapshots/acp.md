# Agent Client Protocol (ACP)

- **URL:** https://agentclientprotocol.com — spec repo https://github.com/agentclientprotocol/agent-client-protocol (4.1k stars, Apache-2.0, active daily); registry https://agentclientprotocol.com/overview/agents
- **Type:** protocol (editor <-> agent)
- **Author/Org:** Zed Industries, now under a neutral `agentclientprotocol` org; JetBrains co-adopter
- **Researched:** 2026-08-26
- **Status/maturity:** protocolVersion 1; stdio transport stable; HTTP transport draft. Native agents: Claude Agent (via Claude Agent SDK adapter), Copilot CLI (preview Jan 2026), Cursor CLI, Cline; 40+ community adapters (Codex, Gemini CLI, OpenCode, OpenHands, Goose, Kimi, Qwen, **pi**, ...). Clients: Zed, JetBrains, Neovim plugins, Emacs, Delta.

## One-paragraph summary

ACP is JSON-RPC 2.0 between a *client* (editor/UI) and an *agent* (subprocess). The client launches the agent with a command+args+env, speaks newline-delimited JSON-RPC over stdin/stdout, and the agent streams `session/update` notifications (message chunks, tool calls with diffs and file locations, plans, mode changes). The client owns the human: it answers `session/request_permission`, and optionally lends its filesystem (`fs/read_text_file`, `fs/write_text_file`) and terminals (`terminal/*`) so the agent can act on *the client's* files even when running elsewhere. It is "LSP for agents": one adapter makes an agent usable from every ACP client.

## Core ideas / thesis

- Decouple agent harness from UI; agents don't ship editors, editors don't ship agents.
- Absolute paths, 1-based lines; the agent reports *locations* so the UI can follow along.
- Tool calls are structured (`kind: read|edit|delete|move|search|execute|think|fetch|other`, `status: pending|in_progress|completed|failed`, `content: [{type: diff, path, oldText, newText}]`), so any client can render diffs and gate permissions uniformly.
- Sessions are first-class: `session/new|load|resume|list|close|delete`, `session/set_mode` (e.g. ask/plan/auto), `session/set_config_option` (model, thinking).
- Client capabilities are negotiated, so an agent can delegate fs/terminal to the client (remote editing) or run locally.

## Architecture & mechanics

**Handshake**
```json
-> {"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,
    "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
    "clientInfo":{"name":"foundry","version":"0.1"}}}
<- {"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,
    "promptCapabilities":{"image":true,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true}},
    "authMethods":[]}}
```
**Agent methods:** `initialize`, `authenticate`, `logout`, `session/new {cwd, mcpServers[]}`, `session/load {sessionId,cwd,mcpServers}` (replays history via updates), `session/resume` (no replay), `session/list`, `session/prompt {sessionId, prompt:[content blocks]}` -> `{stopReason: end_turn|max_tokens|max_turn_requests|refusal|cancelled}`, `session/cancel`, `session/close`, `session/delete`, `session/set_mode`, `session/set_config_option`.
**Client methods:** `session/request_permission {toolCall, options:[{optionId, kind: allow_once|allow_always|reject_once|reject_always}]}`, `session/update` (notification), `fs/read_text_file`, `fs/write_text_file`, `terminal/create|output|wait_for_exit|kill|release`, `elicitation/create|complete`.
**SessionUpdate variants:** `agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `usage_update` (ext).
**Transport:** stdio, `\n`-delimited, UTF-8, stderr free for logs; "Streamable HTTP" is a draft; custom transports allowed if JSON-RPC framing kept.
**MCP passthrough:** client passes MCP server configs in `session/new`; agent is expected to connect to them.

## pi support

- **Not native.** pi ships its own JSONL `--mode rpc` (commands `prompt/steer/follow_up/abort/get_state/get_tree/fork/set_model/...`, events mirror SDK). Issue #175 (Dec 2025) closed without implementation; Discussion #4444 (May–Jul 2026) has a community proposal for `pi --mode acp` (ACP SDK ~329 KB dep, session identity must stay in pi, delegate fs/terminal to client); no maintainer commitment visible.
- **Community adapter: `pi-acp`** (https://github.com/victor-software-house/pi-acp, MIT, v0.17.1 2026-05, also on npm as `pi-acp`, listed on the ACP registry and on https://zed.dev/acp/agent/pi; Zed: `"agent_servers": {"pi-acp": {"type": "registry"}}` or `npx pi-acp@0.0.33`). Embeds pi via `@earendil-works/pi-coding-agent` `createAgentSession` (one in-process agent per ACP session), maps pi tools to ACP `tool_call` (`read|edit|execute|other`) with `oldText/newText` diffs and locations, supports `session/list|load|new`, `resumeSession`, `unstable_forkSession`, `set_config_option` for model/thinking, slash commands/skills/prompt templates, `usage_update`. Delegates *reads* to client fs and optionally `bash` to ACP terminals. **Gaps:** no `session/request_permission` (no pre-execution gate), no fs *write* delegation, MCP configs accepted but not wired, no `plan` updates. Session persistence via pi's normal `~/.pi/agent/sessions/`.

## Workflow: end to end

1. Client spawns `npx pi-acp` (or any agent) → `initialize` → `session/new {cwd}`.
2. Client sends `session/prompt`; agent streams updates; each mutating tool call arrives as `tool_call` (pending) → client may get `session/request_permission` → `tool_call_update` (completed, diff).
3. Client renders diffs/locations live; user replies; `session/cancel` to interrupt.
4. `session/load` later to replay; `session/set_mode` to switch e.g. plan→code.

## Notable techniques worth stealing

- The **ToolCall schema** (kind/status/locations/diff content) is a good neutral event format for a factory's telemetry and review UI regardless of harness — pi's `tool_execution_start/end` events map onto it one-to-one (pi-acp already does the mapping).
- **Permission as a client method with `allow_always` options** — the orchestrator can be the "client" and implement policy centrally.
- **fs/terminal delegation**: an agent process can run anywhere while acting on files owned by the client; inverse of our model, but the same trick lets a *review UI* on a laptop attach to an agent in a VM.
- `session/load` replay lets any UI reconstruct a transcript from the agent's own store — no separate transcript format needed.

## Weaknesses / open questions / risks

- Only stdio is stable: an ACP client must spawn the agent as a child. Cross-VM use needs an SSH/`terminal` shim or the draft HTTP transport.
- pi-acp is a 2-star, single-maintainer adapter with permission gating missing; forks (svkozak/pi-acp) exist. Not something to depend on for headless orchestration; pi's RPC/SDK is richer (tree/fork/steer/compaction).
- ACP has no notion of git/branches/worktrees at all; provenance is out of scope.

## Fit for our agentic stack (pi, one VM per agent)

- **Orchestration: skip.** Drive pi via `--mode rpc`/SDK inside the VM; ACP adds nothing there and loses steer/fork/tree.
- **Human review/attach: adopt later.** Expose each VM's pi through ACP (pi-acp behind an `ssh vm -- npx pi-acp` command in Zed's `agent_servers`, or Delta) so a human can open any running agent in Zed/JetBrains/Delta to watch diffs and reply. Cheap and optional.
- **Event model: adopt the shape.** Normalize pi events to ACP `tool_call`/`tool_call_update` JSON for the factory's event log and review UI; if pi gains native `--mode acp` this becomes free.
- Watch Discussion #4444; if native ACP lands, permission gating via `session/request_permission` becomes a second policy channel besides pi's `tool_call` hook.

## Related resources mentioned

- https://github.com/victor-software-house/pi-acp , https://github.com/svkozak/pi-acp (fork)
- https://github.com/earendil-works/pi/discussions/4444 , https://github.com/earendil-works/pi/issues/175
- https://agentclientprotocol.com/protocol/schema , /protocol/transports , /protocol/initialization
- https://zed.dev/acp/agent/pi
- Zed Delta uses ACP to attach Claude Code sessions (see zed-delta.md)

## Key quotes / references

- "All file paths in the protocol MUST be absolute. Line numbers are 1-based."
- "messages are delimited by newlines (\n), and MUST NOT contain embedded newlines" (transports)
- Discussion #4444: adapter "unable to properly delegate filesystem/terminal operations or handle MCP passthrough".
