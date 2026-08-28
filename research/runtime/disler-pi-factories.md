# IndyDevDan (disler) pi-native factories & agentic-coding material

- **URLs:** https://github.com/disler/inkwell-agent-sandboxes-and-software-factory · https://github.com/disler/super-simple-software-factory · https://github.com/disler/pi-vs-claude-code · https://github.com/disler/claude-code-hooks-multi-agent-observability · https://github.com/disler/the-library · https://agenticengineer.com/the-only-claude-code-competitor · course: https://agenticengineer.com/tactical-agentic-coding (paid)
- **Type:** factory (inkwell, sssf) · skills/agents (pi-vs-cc, the-library) · observability (hooks-observability) · blog/course (TAC)
- **Author/Org:** Dane "IndyDevDan" (disler), Agentic Engineer
- **Researched:** 2026-08-26
- **Status/maturity:** inkwell 143★ (MIT, pushed 2026-08-09); sssf 751★ (MIT, 2026-08-04); pi-vs-claude-code 1.64k★ (MIT, 2026-07-10); hooks-observability 1.53k★ (no license, last push 2026-02-08 — Claude Code only); the-library 414★ (MIT, 2026-03-15). All are teaching repos: small, opinionated, not maintained as libraries. TAC course content is member-only; the "Tier 3" pi orchestration codebases (CEO Board, Lead Agents, Infinite UI Agents) are not public.

## One-paragraph summary

Dan's stance is "the agent harness is the product; whoever controls your harness controls your results" — Claude Code is the "starter pack", pi is the "endgame blank canvas". His public pi work comes in two layers. (1) **pi-vs-claude-code**: ~19 standalone TypeScript pi extensions (`pi -e extensions/<name>.ts`) demonstrating UI minimalism, damage-control policy hooks, dispatcher→specialist teams, peer-to-peer agent comms over an HTTP/SSE hub, sequential agent chains, and a meta-agent that fans out to parallel "experts". (2) **Super Simple Software Factory (SSSF)** and its packaged demo **Inkwell / "Factory in a Box"**: a deterministic Python control plane ("Agent proposes, code disposes") that invokes pi headlessly (`pi -p --mode json --session-id …`) as bounded phases (scout/plan/build/test/review/document), validates every claim with code gates, writes every event to a SQLite WAL trace, and — in the Inkwell repo — runs the whole thing inside disposable exe.dev VMs with a two-tier credential boundary and best-of-N fan-out harvested into `refs/sandbox/<run-id>`. This is the closest existing public example of "a pi-based cloud software factory for a solo dev".

## Core ideas / thesis

- **Core Four control** (context, model, prompt, tools) must be owned by you; pi exposes all four, Claude Code hides them. "Use Claude Code for 80% of daily velocity, Pi for the 20% demanding full control."
- **Deterministic orchestration, bounded agents.** Python (not an LLM) owns sequencing, retries, and acceptance. Agents only act inside a named phase and must return a typed JSON envelope. Every phase "defaults to failure; success must be earned."
- **Gates verify claims after execution**, never predictions (`artifacts_exist`, `files_non_empty`, `json_parses`, `diff_matches_claims`, `tests_pass(...)`). On failure, re-prompt the *same* session with a correction — never restart (context stays intact).
- **Traces are the product interface**: "the loop orbits, you read the trace." One data path (SQLite WAL), queryable offline.
- **Sandbox by credential, not by file deletion**: the VM only ever holds a capped, disposable inference key; the provisioning key and VM-provider credentials never leave the host, which is what prevents a sandbox from mounting sandboxes (one nesting level).
- **Humans decide teardown**; agents may only recommend.
- **Flat peer agents can beat hierarchies** ("the best information wins on merit, not title") — `coms`/`coms-net` extensions.

## Architecture & mechanics

### SSSF (Super Simple Software Factory) — the factory core

```
target-repo/
├── adws/
│   ├── adw_*.py                       # 12 starter workflows, 40–180 lines each (uv run)
│   ├── adw_modules/                   # agent_pi.py, agent_cc.py (stub), gates.py, tracer.py,
│   │                                  # runner.py, session.py, permissions.py, quality.py, git_helper.py …
│   ├── adw_sssf_config/sssf.config.yaml   # roster: per-agent model/thinking/tools/prompts/writes
│   ├── adw_data/
│   │   ├── prompt_engineering/{agent}/system.md, user.md
│   │   ├── harness_engineering/       # pi extensions loaded into phases (subagents.ts, themeMap.ts)
│   │   ├── sessions/                  # pi --session-dir per run
│   │   └── sssf.db                    # SQLite WAL trace (gitignored)
│   └── context_handoff/               # files passed between agents
├── justfile
└── .env.sample                        # OPENROUTER_API_KEY …
```

**Phase types:** Engineer (human kick-off) → Agent (`ph.call(...)`: prompt in, typed envelope out, gate) → Code (deterministic: commit, test, lint; never nested inside agent phases).

**Envelope contract** (must be kept in sync in three places: pydantic type, JSON example in `user.md`, `output_type=` at call site):

```python
class EnvelopeBase(BaseModel):
    status: Literal["success", "fail"]
    summary: str = ""
    artifacts: list[str] = Field(default_factory=list)
    notes_for_next_agent: str = ""
```

**How pi is invoked** (`adws/adw_modules/agent_pi.py`; "Runs `pi -p --mode json` and tails its JSONL stdout line by line"):

```python
cmd = [PI_PATH, "-p", "--mode", "json",
       "--provider", provider, "--model", model_id,
       "--thinking", request.thinking,
       "--session-id", request.session_id,      # create-or-continue ⇒ run and resume are the same call
       "--session-dir", request.session_dir,
       "--system-prompt", request.system_prompt]
if request.tools: cmd += ["--tools", ",".join(request.tools)]
# stdin is closed explicitly: inheriting parent stdin makes pi "sit forever waiting for piped input"
```

- Model resolution goes through `pi --list-models` (merged catalog incl. `~/.pi/agent/models.json`), so rosters use `provider/model-id` (`openrouter/...`) and are validated up-front.
- Context accounting mirrors pi's `core/compaction/compaction.ts` `calculateContextTokens`.
- Tool stream folding: pi emits a `toolCall` content block then `tool_execution_*` events; SSSF folds "three raw events into one queryable row".
- `on_spawn(pid)`/`on_exit(pid)` record the child PID into the `processes` table so hung agents are killable.
- `writes:` boundaries per agent are enforced **after** execution by diffing the repo against the claimed artifacts.
- Gotcha from the Inkwell README: "A partial cost block drops the whole roster. pi requires all four rate fields; miss one and every run reports $0.0000 while genuinely spending."

**Trace schema (`sssf.db`, 7 tables):** `sessions` (adw_id, status, tokens, request), `phases` (sequence, kind, owner, status), `events` (raw: tool calls, logs, status; `parent_id` nests spans), `envelopes`, `gate_results`, `agent_sessions` (pi session id ↔ adw_id), `processes` (PIDs). Readers poll: `select * from events where adw_id=? and rowid>? order by rowid limit 500;`. Trace UI: Bun on :4600 (`just obs ui`, `just obs tail <adw_id>`).

**Starter workflows:** `adw_prompt`, `adw_scout`, `adw_plan`, `adw_build`, `adw_quality`, `adw_plan_build`, `adw_build_test` (builder→test→revise loop), `adw_build_review` (builder→reviewer→revise loop), `adw_plan_build_test`, `adw_plan_build_test_quality`, `adw_document`, `adw_simple_sdlc` (plan→build→test→review→document, three commits). Invoke: `uv run adws/adw_simple_sdlc.py "<prompt>" [--config path] [--adw-id ID] [--agent NAME]`.

Roster (`sssf.config.yaml`): five starter agents — planner, builder, scout (read-only), reviewer, documenter — each with model, thinking (off…max), tools, colour, `writes`. Five roster variants in Inkwell: cheap default, frontier, DeepSeek-only, open-weights, speed. Claude Code is "schema-valid but stubbed" — **pi is the only working harness**.

Explicitly out of scope for SSSF: sandboxing, branch-per-run, cloud infra, human approval phases ("leaving room for teams to build their own production wrapper") — Inkwell adds the first three.

### Inkwell / Factory in a Box — the cloud wrapper

Three command tiers: host orchestrator (VM lifecycle) → in-sandbox orchestrator (Claude Code or pi session on the VM) → ADW phase agents. Two skills drive it: `.claude/skills/sssf-sandbox-orchestrator/SKILL.md` (host) and `.claude/skills/sssf/SKILL.md` (in-VM). Equip-line pattern: `just sbx run agent <id> "READ SKILL.md. Then: <work>"`.

Six-phase VM lifecycle (~10 s cold start on exe.dev): **create** (mint `sbx-<run-id>` OpenRouter key, $50 cap; boot VM) → **fill** (clone repo, pin SHA, write `.env` with runtime key) → **setup** (`provision.sh` + five gate assertions) → **execute** (detached factory run, returns PID) → **observe** (servers, expose :4501, URLs) → **teardown** (harvest, revoke key, destroy VM). `just sbx mount RUN_ID` chains create→fill→setup→observe.

```bash
just sbx mount my-feature                               # create + fill + setup
just sbx lifecycle execute <id> "<work>"                # direct detached run (zero orchestration tokens)
just sbx run agent <id> "READ SKILL.md. Then: <work>"   # agent-mediated (resumable, judgment at kickoff)
just sbx manage list | harvest <id> | doctor | reap     # spend, pull commits → refs/sandbox/<id>, preflight, orphan cleanup
just sbx lifecycle teardown <id>                        # human-only decision
just local pi                                           # local pi session on host
```

Credential boundary:

| layer | credential | scope |
|---|---|---|
| host | exe.dev account + OpenRouter **provisioning** key | mints runtime keys, destroys VMs; never leaves host |
| VM | disposable `sbx-` **runtime** key, $50 cap | inference only; spent in setup gate, revoked at teardown |

Best-of-N: mount N sandboxes with different rosters (`--limit N`), same prompt, harvest each to `refs/sandbox/<run-id>` as git bundles (idempotent, works before/after teardown), human picks the winner, no auto-merge (`cookbooks/fan_out_n.md`).

### pi-vs-claude-code — extension patterns

Loaded with `pi -e extensions/<name>.ts` or `just ext-<name>`; agents in `.pi/agents/*.md` (frontmatter `name/description/tools` + system prompt; also scans `agents/` and `.claude/agents/`), teams in `.pi/agents/teams.yaml`, policy in `.pi/damage-control-rules.yaml`.

| extension | mechanism (pi APIs) |
|---|---|
| `agent-team.ts` | `registerTool("dispatch_agent")`, `setActiveTools(["dispatch_agent"])` so the dispatcher cannot touch code; `before_agent_start` injects the roster; children spawned as `spawn("pi", ["--mode","json","--session",<persistent file>,…])` — persistent per-specialist session file = memory across dispatches. **Sequential only.** |
| `pi-pi.ts` | Meta-agent: `query_experts` tool fans out `Promise.allSettled(queries.map(queryExpert))`, each expert `pi --mode json --append-system-prompt … --tools …` with thinking off; parses `message_update`/`text_delta` incrementally; 12k-char truncation, full output in `details`. |
| `agent-chain.ts` | Sequential pipeline; each output feeds the next. |
| `coms.ts` / `coms-net.ts` | Peer-to-peer. `coms-net`: Bun HTTP/SSE hub; on `session_start` POST register {session_id,name,purpose,model,cwd}; tools `coms_net_list/send/get/await`; inbound prompt delivered via `pi.sendMessage({customType:"coms-net-inbound"}, {deliverAs:"followUp", triggerTurn:true})`; at `agent_end` the last assistant text is auto-POSTed back as the reply; `pi.appendEntry("coms-net-log")` audit; `registerFlag("--cname","--server-url")`. |
| `damage-control.ts` | `tool_call` hook: regex bash patterns (`rm -rf`, `DROP DATABASE`), zero-access / read-only / no-delete path zones, optional confirm. |
| `subagent-widget.ts` | Background spawn with `ctx.ui.setWidget` progress. |
| `purpose-gate.ts`, `pure-focus.ts`, `minimal.ts`, `session-replay.ts`, `tilldone.ts`, `tool-counter*.ts`, `system-select.ts`, `theme-cycler.ts` | UI/footer, gating prompts by declared purpose, replaying sessions, "loop until done". |

Inkwell's in-VM harness extension `adws/adw_data/harness_engineering/subagents.ts` is the same pattern: `/sub [--model p/m] [--thinking lvl] <task>` → `spawn("pi", ["--mode","json", "--model", …])` with a persistent session per subagent; tools `subagent_create/continue/remove/list`.

### the-library & hooks-observability (peripheral)

- **the-library**: a meta-skill (`SKILL.md` + `library.yaml` + `cookbook/`) cataloguing skills/agents/prompts by *pointer* (local path or GitHub URL), typed deps (`requires: [skill:x, agent:y, prompt:z]`), `/library add|use|push|sync|search`. Explicitly harness-agnostic: "Any agent harness that reads skill files can run it (Claude Code, Pi, etc.)". Useful for sharing one skill library between Claude Code and pi.
- **claude-code-hooks-multi-agent-observability**: Claude Code hooks (`.claude/hooks/send_event.py`) → `POST /events` (Bun + SQLite WAL) → WS → Vue dashboard with per-session swim lanes and a pulse chart; 12 event types (PreToolUse … SubagentStart/Stop, PreCompact). **No pi support**; but it is the direct ancestor of the SSSF trace DB (same "one SQLite, WAL, poll" idea) and a template for a pi `tool_execution_*`/`turn_*` → HTTP exporter extension.

## Workflow: end to end (Inkwell)

1. Host: `just sbx manage doctor` → `just sbx mount feat-x` (VM up, repo filled, provision gates pass, runtime key minted).
2. Kick off: `just sbx lifecycle execute feat-x "Add tag filtering to posts"` (detached, PID tracked) — or agent-mediated via the in-VM skill.
3. In VM: `adw_simple_sdlc.py` runs planner → builder → test (code) → reviewer → documenter, each a `pi -p --mode json --session-id <adw>-<phase>` call; gates validate envelopes/diffs/tests; corrections re-prompt the same session; three commits land.
4. Observe from host: `just obs tail <adw_id>` / `just obs ui` reading `sssf.db` over the VM.
5. `just sbx manage harvest feat-x` → commits in `refs/sandbox/feat-x`; for best-of-N compare N refs; human merges.
6. Human decides `just sbx lifecycle teardown feat-x` (revokes key, destroys VM).

## Notable techniques worth stealing

- `--session-id` as create-or-continue so "run" and "resume with correction" are the same call; corrections stay in-context instead of restarting.
- Typed envelope + post-hoc gates (`diff_matches_claims`, `tests_pass`) — trust nothing the model says.
- Per-agent `writes:` allowlist enforced by diff after the fact (cheap, harness-independent) — complement with a `tool_call` hook for pre-emption.
- Single SQLite WAL trace with `adw_id`/`phase_id`/`parent_id` spans; PID table for kill-ability; content-based health checks (`pi --list-models` output, not exit codes).
- Two-tier credentials: provisioning key on host, capped `sbx-` runtime key per VM, prefix-based orphan reaping.
- `refs/sandbox/<run-id>` git-bundle harvest, decoupled from teardown; best-of-N by roster.
- `setActiveTools(["dispatch_agent"])` to make a pure dispatcher; persistent per-specialist session files for memory.
- `pi.sendMessage(..., {deliverAs:"followUp", triggerTurn:true})` + `agent_end` capture = a mailbox that turns any pi into a network peer.
- Explicit stdin close when spawning headless pi.

## Weaknesses / open questions / risks

- Teaching repos: no tests of the orchestrator itself, single-maintainer, tied to exe.dev and OpenRouter; `agent_cc.py` is a stub.
- SSSF is a linear chain per ADW — no queue, no retries across VMs, no concurrency inside a run except `subagents.ts`; best-of-N is manual.
- No sandbox *inside* the VM (pi in YOLO mode on the VM); isolation is entirely VM + credential scoping.
- Peer-to-peer comms (`coms-net`) has no auth beyond a token and no delivery guarantees; hub is a single Bun process.
- The "Tier 3" orchestration codebases (Lead Agents three-tier, CEO Board) are paywalled; the free repos stop at sequential dispatch.
- hooks-observability is unmaintained since Feb 2026 and Claude Code-only.

## Fit for our agentic stack

**Adopt:** SSSF's shape — a thin deterministic controller that calls `pi -p --mode json --session-id … --system-prompt … --tools …` per phase, typed envelopes, gates, and one trace DB — is essentially our per-task worker loop. Port the concepts (not the Python) into our controller; keep the envelope/gate/trace ideas and the `--session-id` correction loop. Adopt Inkwell's credential boundary and `refs/sandbox/<run>` harvest for cloud sandboxes (swap exe.dev for whichever VM provider we choose; see exe-dev.md / Sprites). **Adapt:** `damage-control`-style `tool_call` policy + `writes:` diff gate as belt-and-braces; `coms-net` pattern for a controller→worker mailbox if we don't use pi-server. **Skip:** the-library (we'll use plain `.agents/skills/` in-repo), hooks-observability (write a pi extension exporter instead), paid course material.

## Related resources mentioned

- https://github.com/disler/super-simple-software-factory — the factory core (SSSF); standalone, stamped into any repo as a skill.
- https://exe.dev / exeuntu image — VM provider Inkwell uses; pi preinstalled (see research/sandbox/exe-dev.md).
- IndyDevDan YouTube (@indydevdan) and TAC course — PITER model / AFK agents / "12 leverage points"; not public.
- Claude Code hooks observability → candidate to port as a `pi-observability` extension.

## Key quotes / references

- "Agent proposes, code disposes." — SSSF/Inkwell README
- "The loop orbits, you read the trace." — Inkwell README
- "Neither credential ever leaves the host, and that, not file absence, is what stops a sandbox from mounting sandboxes." — sssf-sandbox-orchestrator SKILL.md
- "Whoever controls your agent harness controls your results." / "Claude Code = starter pack, Pi = endgame" — agenticengineer.com
- "two equal Pi agents that talk to each other peer-to-peer … the best information to win on merit, not title" — pi-vs-claude-code README

## Gaps / not verified

- Did not read `gates.py`, `tracer.py`, `permissions.py` source line-by-line; gate list and schema come from the README.
- Did not read `sssf` in-VM SKILL.md or `cookbooks/fan_out_n.md`.
- TAC course specifics (PITER, ZTE, "closed-loop prompting") only known from marketing pages.
