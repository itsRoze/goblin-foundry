# disler/claude-code-hooks-mastery → pi extension event mapping

- **URL:** https://github.com/disler/claude-code-hooks-mastery ; hooks reference https://code.claude.com/docs/en/hooks
- **Type:** skills/agents (hook reference implementation) + mapping note
- **Author/Org:** IndyDevDan (disler)
- **Researched:** 2026-08-26
- **Status/maturity:** 3.9k stars, 639 forks, no license file, 10 commits, last push 2026-03-04 (stale; covers 13 events, Claude Code now has 31). Still the most complete worked example of hook scripts.

## One-paragraph summary

The repo wires every hook event it knew about (13) to a `uv run` single-file Python script in `.claude/hooks/`, each logging its stdin JSON to `logs/<event>.json`, some adding control: `pre_tool_use.py` exits 2 on dangerous `rm -rf` patterns and any `.env` access (except `.env.sample`); `user_prompt_submit.py` can validate/block prompts, store the last prompt, and name the session; `stop.py --chat` dumps a readable transcript and optionally announces completion via TTS (ElevenLabs > OpenAI > pyttsx3) with an LLM-generated one-liner (Anthropic > OpenAI > Ollama); `post_tool_use.py` runs `ruff`/`ty` validators. It also ships a Builder/Validator agent pair, a meta-agent that writes agents, 8 output styles, 9 status lines, and `/plan_w_team`. Below, each hook is mapped to pi's `pi.on(...)` events from research/runtime/pi.md.

## Core ideas / thesis

- **Deterministic control outside the model**: hooks are where policy lives (block, inject, log), the LLM never gets a vote.
- Exit-code contract: `0` = ok (stdout may become context), `2` = block (stderr fed to Claude), other = non-blocking error. JSON on stdout for finer control (`decision`, `permissionDecision`, `updatedInput`, `additionalContext`, `continue`).
- Every event logged as JSON = free observability.

## Architecture & mechanics

### settings.json (verbatim shape)
```json
{ "hooks": { "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command",
      "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/pre_tool_use.py" }]}],
    "Stop": [{ "hooks": [{ "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/stop.py --chat" }]}],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/user_prompt_submit.py --log-only --store-last-prompt --name-agent" }]}] , "...": "PostToolUse, Notification --notify, SubagentStop --notify, PreCompact, SessionStart, SessionEnd, PermissionRequest --log-only, PostToolUseFailure, SubagentStart, Setup" },
  "statusLine": { "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/status_lines/status_line_v6.py" } }
```
Scripts start with `#!/usr/bin/env -S uv run --script` + PEP 723 `# /// script` deps block: zero project deps, portable.

### Hook catalog (repo) and control used

| Event | Script / flags | Behavior | Control |
|---|---|---|---|
| UserPromptSubmit | `--validate --log-only --store-last-prompt --name-agent` | log; optional block on blocked patterns; write `logs/session_<id>/last_prompt`; LLM names the session | exit 2 blocks prompt; stdout → context |
| PreToolUse | `pre_tool_use.py` | regex-block `rm -r*f*` incl. `~`, `/`, `..`, `*`; block Read/Edit/Write/Bash touching `.env`; log | `sys.exit(2)` + stderr `BLOCKED: …` |
| PostToolUse | + `validators/ruff_validator.py`, `ty_validator.py`, `validate_new_file.py`, `validate_file_contains.py` | log; lint/type-check edited Python | JSON `{"decision":"block","reason":…}` re-prompts Claude |
| PostToolUseFailure | | structured error log | none |
| Notification | `--notify` | TTS "your agent needs your input" | none |
| Stop | `--chat --notify` | log; `chat.json` transcript; LLM completion message + TTS | exit 2 / `{"decision":"block","reason"}` forces continuation |
| SubagentStart / SubagentStop | `--notify` | log; TTS | SubagentStop can block |
| PreCompact | | log manual/auto trigger, backup transcript | none |
| SessionStart / SessionEnd | | log; inject context (git status, recent issues); cleanup temp files | stdout → context |
| PermissionRequest | `--log-only` | log; could auto-decide | JSON `decision: allow|deny` |
| Setup | | init/maintenance | none |

Not covered by the repo but in current Claude Code (31 events): UserPromptExpansion, PermissionDenied, PostToolBatch, StopFailure, TaskCreated/TaskCompleted, TeammateIdle, MessageDisplay, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate/Remove, PostCompact, Elicitation/ElicitationResult. Hook types now: `command`, `http`, `mcp_tool`, `prompt`, `agent`; fields `if` (`Bash(rm *)`), `async`, `once`, `timeout`, `statusMessage`; hooks can live in skill/agent frontmatter.

### Mapping to pi extension events

pi has no external hook protocol; the equivalent is an in-process TypeScript extension (`.pi/extensions/*.ts` or a package) using `pi.on(event, (ev, ctx) => …)`. Handlers can return objects to block/mutate.

| Claude Code hook | pi event(s) | Fidelity / notes |
|---|---|---|
| SessionStart (`startup|resume|clear|compact|fork`) | `session_start` (reason `startup|reload|new|resume|fork`), `project_trust` | Direct. Inject context via `before_agent_start` (`{systemPrompt}`) or `pi.sendMessage(...)` |
| Setup (`--init`) | none; use `pi install` / package `package.json` scripts | Gap |
| UserPromptSubmit | `input` (return `continue|transform|handled`) | Direct: transform = rewrite prompt, handled = block. `--name-agent` → `pi.setSessionName()` |
| UserPromptExpansion | `input` (slash templates expand before `input`?) / prompt templates | Partial |
| PreToolUse (allow/deny/updatedInput/additionalContext) | `tool_call` → `{block:true, reason, terminate?}` or mutate `event.input` in place | Direct; richer (can terminate the run) |
| PermissionRequest / PermissionDenied | `tool_call` + `ctx.ui.confirm()` | pi has no built-in permission prompt; extension implements it (see pi-permission-system, pi-guardrails) |
| PostToolUse / PostToolUseFailure | `tool_result` (rewrite `content`/`isError`), `tool_execution_end` | Direct; "block + reason" = append to result content or `pi.sendUserMessage(reason, {deliverAs:"followUp"})` |
| PostToolBatch | `turn_end` | Approximate |
| Stop (block to continue) | `agent_end` / `agent_settled` + `pi.sendUserMessage("continue…", {deliverAs:"followUp"})` | Approximate: cannot veto the stop, but can queue a follow-up turn which is the same effect |
| StopFailure | `after_provider_response` / retry settings | Partial |
| SubagentStart / SubagentStop | none in core; pi-subagents extension emits its own; or `session_start` in the child process (`PI_SESSION_ID` env) | Gap in core |
| TaskCreated / TaskCompleted / TeammateIdle | none | Gap (factory orchestrator concern) |
| Notification | `ctx.ui.notify`, `agent_settled` | Direct for "needs input" (`ctx.ui.confirm/select` are the input points) |
| MessageDisplay | `message_start/update/end`, `registerMessageRenderer` | Direct |
| InstructionsLoaded | `resources_discover` | Partial (fires for discovery, not per-file load) |
| ConfigChange / FileChanged / CwdChanged / DirectoryAdded | none; `session_start` reason `reload` after `/reload` | Gap; use `fs.watch` inside the extension |
| WorktreeCreate / WorktreeRemove | none | Gap (pi-subagents / pi-dynamic-workflows handle worktrees themselves) |
| PreCompact / PostCompact | `session_before_compact` (`{cancel:true}`), `session_compact` (custom summary), `session_compact_failed` | Direct, and stronger (supply your own summary) |
| Elicitation / ElicitationResult | pi-mcp-adapter internals | Gap |
| SessionEnd | `session_shutdown`, `session_before_switch/fork/tree` | Direct |
| statusLine command | `ctx.ui.setStatus()` / `setWidget()` | Direct (TUI only) |
| Output styles | `before_agent_start` system prompt, `APPEND_SYSTEM.md`, `registerMarkdownTransformer` | Direct |
| `type: prompt` / `type: agent` hooks (LLM-judged) | run `pi -p` subprocess or `createAgentSession` in the handler | Doable, not built in |
| `type: http` hooks | `fetch()` in handler | Trivial |

Data available to pi handlers vs Claude JSON: `ctx.sessionManager` (full entries), `ctx.cwd`, `ctx.model`, `ctx.getContextUsage()`; `event.toolName`, `event.input`; env `PI_SESSION_ID`, `PI_SESSION_FILE` for children. Persist via `pi.appendEntry("goblin/hook-log", {...})` (in session, not in LLM context) instead of `logs/*.json`.

## Workflow: end to end (porting the repo)

1. Keep `.claude/hooks/*.py` as-is for Claude Code.
2. Write `pi/extensions/goblin-hooks.ts`: `tool_call` → spawn the same `pre_tool_use.py` with a synthesized Claude-shaped JSON (`{hook_event_name:"PreToolUse", tool_name, tool_input, cwd, session_id}`) on stdin; exit 2 → `{block:true, reason: stderr}`; parse stdout JSON `hookSpecificOutput.updatedInput` → mutate `event.input`. Same shim for `tool_result` → `post_tool_use.py`, `input` → `user_prompt_submit.py`, `agent_end` → `stop.py`, `session_start/shutdown`.
3. Map tool names (`Bash`→`bash`, `Edit`→`edit`, `Write`→`write`, `Read`→`read`) in the shim so scripts stay shared.
4. Log every event with `pi.appendEntry` and mirror to `logs/` for parity.

## Notable techniques worth stealing

- **One shim, shared scripts**: a Claude-hook-JSON compatibility layer inside a pi extension makes every existing hook script (this repo, Pocock's `block-dangerous-git.sh`, hookify output) run under pi unchanged. This is the cheapest way to get a portable policy layer.
- `uv run --script` single-file hooks with inline deps: no venv, works in sandboxes with `uv` preinstalled.
- `.env` access blocking across Read/Edit/Write/Bash with `.env.sample` allowlist.
- `Stop` hook "block with reason" as a completion gate (run tests; if red, `decision: block, reason: "tests failing: …"`); pi analog: `agent_end` + follow-up message.
- `--name-agent` session naming from first prompt → `pi.setSessionName`.
- Builder/Validator agent split + `/plan_w_team` task DAG: maps onto pi-subagents chains.
- Per-event JSON logs as a session audit trail (pi: session JSONL already is one).

## Weaknesses / open questions / risks

- Repo stale since 2026-03; covers 13/31 events and pre-dates `if`, `async`, `once`, `http/prompt/agent` hook types and `permissionDecision` JSON.
- No license.
- Crypto agent examples are noise; TTS/LLM utils drag API keys into hooks.
- pi gaps that matter for a factory: no subagent lifecycle events in core, no worktree events, no task events, no veto on stop. All are orchestrator-level in our design anyway (the factory spawns pi processes, so it sees start/stop itself).
- pi extensions run with full process permissions and hot-reload from `.pi/extensions` (trust-gated); a malicious repo can ship one. Sandboxing must not rely on the extension.

## Fit for our agentic stack

Build `@goblin-foundry/pi-hooks` (pi extension) with (1) the Claude-hook-JSON shim above, (2) built-in policies: dangerous-git/rm/.env blocks, `allowed-tools` honoring from loaded skills, read-only phase via `pi.setActiveTools`, (3) telemetry via `pi.appendEntry` + pi-telemetry spans, (4) completion gate on `agent_end` (run `scripts/gate.sh`, follow-up if red). Ship `claude/hooks.json` in the plugin pointing at the same `scripts/`. Result: one policy codebase, both harnesses.

## Related resources mentioned

- pi policy extensions to reuse rather than rewrite: https://github.com/carderne/pi-sandbox , https://github.com/gotgenes/pi-packages (pi-permission-system), https://github.com/aliou/pi-guardrails (already queued).
- Anthropic `hookify` plugin (generates hooks from conversation patterns) and `dash0` (OTel via hooks).
- Claude Code hooks reference (31 events, 5 hook types) https://code.claude.com/docs/en/hooks ; `hooks.md` / `hooks-guide`.
- disler's related repos: `claude-code-hooks-multi-agent-observability` (hooks → websocket dashboard), `fusion-harness` (already researched).
- `uv` single-file scripts guide (`ai_docs/legacy/uv-single-file-scripts.md`).

## Key quotes / references

- "Exit Code 2: Blocking Error. Critical: `stderr` is fed back to Claude automatically." (README)
- "Stop Hook - CAN BLOCK STOPPING ... use this to FORCE CONTINUATION" (README)
- pi: `pi.on("tool_call", …) return { block: true, reason: "policy", terminate: false }` (research/runtime/pi.md)

## Gaps / fetch notes

- Read settings.json, pre_tool_use.py, flag lists of stop/user_prompt_submit/post_tool_use, README headings and flow-control section; did not read validators, TTS/LLM utils, agents, or `/plan_w_team`. pi event semantics taken from research/runtime/pi.md, not re-verified against pi source this round.
