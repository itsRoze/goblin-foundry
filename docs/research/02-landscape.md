# Landscape: Agentic Software Factories (survey as of 2026-08-18)

Scope: systems that turn tickets or specs into code via AI agents. For each: what it is, how the
ticket→agent→PR loop is modeled, human-in-the-loop points, isolation, observability, licensing, and
one line on what's worth stealing.

Conventions used below:
- **[VERIFIED]** — confirmed from a primary source (repo, docs site, vendor page).
- **[PARTIAL]** — exists, but some claimed details could not be confirmed from a primary source.
- **[UNCONFIRMED]** — could not verify existence or current status.

Star counts are point-in-time as reported by the GitHub API on 2026-08-18.

**Contents**
- §0 — The reference implementation: disler/super-simple-software-factory
- §A — Local-first orchestrators / "kanban for coding agents"
- §B — Spec-driven development & planning-first workflows
- §C — AI-native issue trackers & ticket→agent assignment
- §D — Commercial / cloud autonomous coding agents
- §E — Anthropic's own surface area (what you'd build on)
- §F — Concepts, essays, and the discourse
- §G — Observability & telemetry tooling
- Synthesis — (a) convergent patterns · (b) gaps · (c) what to study · (d) schemas to copy

---

## 0. The reference implementation: disler/super-simple-software-factory (SSSF)

**[VERIFIED]** — cloned and read at `main` and `example` branches.
- Repo: https://github.com/disler/super-simple-software-factory
- Video: https://youtu.be/haUfb1ievTE
- License: MIT. Language: Python (orchestration) + Vue/Vite/Bun (visualizer). Author: disler / IndyDevDan.

**What it is.** A "software factory" packaged as a **Claude Code skill** (`.claude/skills/sssf/`) that
you *stamp* into any repo. Deterministic Python owns the workflow graph; coding agents are bounded
nodes inside it. Tagline: **"Agent proposes, code disposes."**

**The core thesis (worth internalizing):**
> "Hand a capable model your whole SDLC and you get a machine with no seams. There is no phase
> boundary, so you cannot say which step failed... A retry is a cold start that throws away everything
> the agent just learned. The only trace is a transcript you have to read like a novel."

The fix: **code owns sequencing, retries, and acceptance; the agent owns only the work inside one
bounded phase.** Everything else falls out of that: phases become the unit of the trace, envelopes
become the only way context crosses a seam, gates become the definition of done.

**Loop model.** An "ADW" (AI Developer Workflow) is a 40–180 line Python script that is a list of
phases. Three phase *kinds*, which are literally the three swim lanes:

| kind | lane | meaning |
|---|---|---|
| `engineer` | human lane | the human's ask |
| `agent` | agent lane | `ph.call(AgentCall(...))` — prompt in, typed envelope out, gates verified |
| `code` | code lane | deterministic step (commit, lint, test, git diff) — never buried inside an agent phase |

Twelve starter workflows ship: `adw_prompt`, `adw_scout`, `adw_plan`, `adw_build`, `adw_quality`,
`adw_plan_build`, `adw_build_test`, `adw_build_review`, `adw_plan_build_test`,
`adw_plan_build_test_quality`, `adw_document`, `adw_simple_sdlc` (plan→build→test→review→document).

**Roster config** (`sssf.config.yaml`) — one agent = one prompt = one purpose, each with its own
model, thinking level, tools, prompts, harness extensions, lane colour, and a `writes:` boundary:

```yaml
defaults:
  coding_agent: pi
  model: google/gemini-3.6-flash    # provider/model-id
  thinking: medium                   # off|minimal|low|medium|high|xhigh|max
  protected_files: [adws/adw_modules/, adws/adw_sssf_config/, adws/adw_*.py]
agents:
  - name: planner
    model: fireworks/.../kimi-k3
    thinking: high
    color: "#a78bfa"                 # this agent's lane swatch in the trace
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering: {system: .../planner/system.md, user: .../planner/user.md}
    harness_engineering: [.../subagents.ts]
    writes: [specs/]                 # enforced in CODE after every call, diff-checked & rolled back
```

Key distinction: **`tools` is a capability list; `writes` is the boundary.** `bash` can run
`git checkout` and `write` reaches any path, so read-only-ness is enforced by diffing the repo before
and after the call and rolling back unauthorized changes (`permissions.py`). Five starter agents:
`planner`, `builder`, `scout` (read-only recon), `reviewer`, `documenter`. **No tester agent —
running a suite is a known command, therefore code.**

**Envelopes (the handoff contract).** An agent has exactly two output channels: reference files in
`context_handoff/`, and one final valid-JSON response parsed against a declared Pydantic type.
Context transfers **in code, not in conversation**:

```python
class EnvelopeBase(BaseModel):
    status: Literal["success", "fail"]   # only required field; status="fail" fails the phase
    summary: str = ""
    artifacts: list[str] = []
    notes_for_next_agent: str = ""

class PlanOutput(EnvelopeBase):     commit_message: str = ""
class BuildOutput(EnvelopeBase):    changed_files: list[str] = []; commit_message: str = ""
class ScoutOutput(EnvelopeBase):    findings: list[ScoutFinding] = []   # {file, note}
class ReviewOutput(EnvelopeBase):   approved: bool = False
                                    findings: list[ReviewFinding] = []  # {requirement, met, evidence}
                                    blocking: list[str] = []
class DocumentOutput(EnvelopeBase): document_path: str = ""; documented_files: list[str] = []
```

Two of these are **adapters** — code shaped as an envelope so an agent consumes a deterministic result
through the same door: `VerifyOutput` (a lint/test block's result) and `ChangesOutput` (a captured
git diff). "The consuming agent cannot tell the difference, which is the point."

**Gates.** `gate(envelope, run) -> GateReport`, run *after* the fact against the envelope's own
declarations: `artifacts_exist`, `files_non_empty`, `json_parses`, `diff_matches_claims`,
`tests_pass(...)`. A gate records **evidence, not just a verdict** — one `{item, ok, note}` check per
thing examined, so a *green* gate can answer "what did you verify?"
(`{"item": ".../plan.md", "ok": true, "note": "exists, 454B"}`).

**Correction, not restart.** When JSON fails to parse or a gate returns violations, **nothing
restarts** — the harness re-prompts the *same live session* with a correction naming exactly what was
wrong, so the context window stays intact. "A cold restart throws away everything the agent learned.
A correction costs one message."

**The output contract lives in three places and must be edited together**: the Pydantic type, the
JSON example in that agent's `user.md` `## Report` section, and `output_type=` at the call site.

**Trace / observability — the single best thing to steal.** One data path, no exceptions:
**agents → SQLite → web UI.** `agent_pi.py` tails the coding agent's JSONL stdout line by line and
inserts each event *while the agent is still working*. Seven tables:

```sql
sessions(adw_id PK, adw_name, request, status, engineer, started_at, ended_at,
         total_tokens, total_cost, archived)          -- archived = human triage flag, set only by UI
phases(phase_id PK, adw_id, seq, name, kind, owner, description,
       status DEFAULT 'fail', attempt, retries, error, started_at, ended_at)
events(event_id PK, adw_id, phase_id, parent_id, type, name,
       payload_json, tokens, started_at, ended_at)    -- ended_at only on events that span time
envelopes(envelope_id PK, adw_id, phase_id, agent, output_type, payload_json, valid, attempt, created_at)
gate_results(id PK, adw_id, phase_id, attempt, gate, passed, violations_json, checks_json, created_at)
processes(id PK, adw_id, kind, name, pid, command, started_at, ended_at)  -- kill a hung run
agent_sessions(adw_id, agent, coding_agent, model, color, session_id,
               context_tokens, context_window, created_at, last_used_at, PRIMARY KEY(adw_id, agent))
```

Ten event types: `phase_start | phase_end | agent_start | agent_end | tool_call | handoff |
gate_pass | gate_fail | log | error`. `parent_id` nests spans so an agent phase expands into its
tool calls. A `tool_call` is the **only** event that spans time (fills `started_at` + `ended_at`), is
named the way you'd read it aloud (`bash: ls -la src`), and carries
`{tool, tool_call_id, args, result_snippet, ok, duration_ms, agent}`.

Two insights most people get wrong, spelled out in their observability reference:
- **Spend vs. occupancy.** `events.tokens` / `sessions.total_tokens` bill every turn and only grow.
  `context_tokens` is *window occupancy after the last valid assistant turn* — a different number, and
  the one a "context bar" must measure against `context_window`.
- **Retries must be summed.** `agent_end.usage` carries the per-component breakdown
  (`input`, `output`, `cache_read`, `cache_write` — tokens *and* dollars) summed over *every* send the
  phase made, so a phase that retried shows what all attempts cost. `reasoning_tokens` is nested
  *inside* output, not a fifth component.

**Transport = polling, deliberately.** No WebSocket, no ingest endpoint, no separate replay path:

```sql
SELECT ... FROM events WHERE adw_id = ? AND rowid > ? ORDER BY rowid LIMIT 500;
```

Keep the highest rowid as the cursor; poll every `poll_ms` (default 500). "Live view and full history
are the same query at different cadence." Every connection opens
`PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000;`.

**Phase status invariants:** `queued` (declared but not entered — dashed in the UI) → `running` on
enter → only a clean exit writes `success`; agent phases additionally need the envelope parsed *and*
gates green. Everything else resolves to `fail`. **"Success must be earned."**

**Human-in-the-loop:** essentially none in v1 — the README says so explicitly. Also **no isolation**:
"It runs on your current branch. There is no sandbox, no branch per run, no merge step, no cloud, and
no human-in-the-loop approval phase. Those are the obvious next things to build."

**The ten hard rules** (from `SKILL.md` — this is the design doc in miniature):
1. **Validate before running** — every workflow declares `REQUIRED_AGENTS` and validates first; a
   missing/misnamed agent fails *before anything spawns*.
2. **Typed outputs only** — parse failures re-prompt the same session, never restart. The contract is a
   **synced triad**: the type, the JSON example in the agent's `user.md` `## Report` section, and
   `output_type=` at every call site.
3. **Gates validate claims, not guesses.**
4. **Four-param rule** — >4 params becomes one typed object (`AgentCall`, `PhaseParams`).
5. **One agent, one prompt, one purpose** — identity in `system.md`; task shape at the call site.
6. **Workflow scripts stay thin** — all low-level logic in modules.
7. **Every phase earns a description** — one sentence on what it does and why; a restatement of the
   name is *rejected at construction time*. It is the only intent the trace/console/UI ever shows.
8. **A known command is code, not an agent.**
9. **`tools:` is a capability list, `writes:` is the boundary** (enforced post-hoc by diff + rollback).
10. **Every run ends in `run.finish(accepted=…)`** — phases passing ≠ the run being acceptable; one
    call settles exit code, session status, and banner so they cannot disagree.

Also notable: the skill's **startup discipline** forbids the orchestrator from volunteering a status
dashboard before the request arrives — "volunteered state is guessed state… it is stale on arrival."
Specs are **lazy-loaded through a routing table** (nine cookbooks), not front-loaded.

**Worth stealing:** all of it — the three-lane phase model, typed envelopes + after-the-fact gates,
correction-in-session instead of restart, and the events-table-as-the-only-transport polling design.
It is also honest about what it lacks (branch-per-run, sandbox, HITL approval), which is precisely the
delta you'd be building.

---

## Section A — Local-first orchestrators / "kanban for coding agents"

**Headline finding: this category churned violently in 2026.** Several flagship projects are dead,
renamed, or sunsetting. **Git worktrees decisively won as the local isolation primitive**;
containers/microVMs appear only at the cloud tier. Read this section as much for the *failure pattern*
as for the designs.

### A1. Vibe Kanban (BloopAI/vibe-kanban) — ⚠️ SUNSETTING, still the best reference implementation
**[VERIFIED]** 27.8k★, Apache-2.0, Rust + SQLite + React.
https://github.com/BloopAI/vibe-kanban · shutdown notice: https://vibekanban.com/blog/shutdown

Kanban board that drives 10+ coding-agent CLIs in isolated workspaces. Bloop announced shutdown
**2026-04-10**; the README now reads "Vibe Kanban is sunsetting," cloud was retired, and the last push
was 2026-04-24. **The code remains the most instructive artifact in the whole survey.**

**Loop model.** `TaskStatus = Todo | InProgress | InReview | Done | Cancelled`. Object lineage
(readable off 80+ migrations, and it *evolved* in a very informative direction):

> **task → workspace (branch + worktree) → session (agent) → execution_process (OS process) →
> coding_agent_turn (prompt/summary)**

`task_attempts` was renamed to `workspaces` in Dec 2025
(`20251216142123_refactor_task_attempts_to_workspaces_sessions.sql`), splitting executor identity into
a new `sessions` table so **one workspace can host multiple agents**. `executor_sessions` became
`coding_agent_turns`. Merges live in their own table with a CHECK constraint enforcing direct-vs-PR
exclusivity.

```sql
-- execution_processes (current)
run_reason      TEXT CHECK (run_reason IN ('setupscript','codingagent','devserver','cleanupscript'))
status          TEXT CHECK (status IN ('running','completed','failed','killed'))
executor_action TEXT NOT NULL DEFAULT '{}'
```

**The executor abstraction — the single best idea in the category.** `ExecutorAction` is a *linked
list*; that is the entire dependency/queueing engine:

```rust
pub enum ExecutorActionType { CodingAgentInitialRequest, CodingAgentFollowUpRequest,
                              ScriptRequest, ReviewRequest }
pub struct ExecutorAction { pub typ: ExecutorActionType,
                            pub next_action: Option<Box<ExecutorAction>> }
```

Setup script → coding agent → cleanup script is just a chain. Every agent CLI (`claude`, `codex`,
`gemini`, `amp`, `cursor`, `copilot`, `opencode`, `droid`, `qwen`, ACP) ships a parser that normalizes
into **one common event schema**:

```rust
pub enum NormalizedEntryType {
  UserMessage, UserFeedback{denied_tool}, AssistantMessage,
  ToolUse{tool_name, action_type, status}, SystemMessage, ErrorMessage{error_type}, Thinking,
  Loading, NextAction{failed, execution_processes, needs_setup}, TokenUsageInfo(..),
  UserAnsweredQuestions{..} }
pub enum ActionType { FileRead, FileEdit{path,changes}, CommandRun{command,result,category},
  Search, WebFetch, Tool{..}, TaskCreate{description,subagent_type,..},
  PlanPresentation{plan}, TodoManagement{todos} }
pub enum ToolStatus { Created, Success, Failed, Denied{reason},
                      PendingApproval{approval_id}, TimedOut }
pub enum ApprovalStatus { Pending, Approved, Denied{reason}, TimedOut }
```

**HITL:** diff review with inline comments fed back to the agent as context; `PendingApproval{approval_id}`
tool gating; follow-up drafts persisted in a polymorphic `scratch` table
(`DraftTask | DraftFollowUp | DraftWorkspace | DraftIssue | WorkspaceNotes | UiPreferences | …`).
**Isolation:** git worktrees (`worktree-manager` crate, per-path mutex against creation races) + a
branch per workspace; Docker only for self-hosting the server.
**Observability:** live normalized log stream, diffs, token usage vs. context window, built-in browser
preview + devtools.

**Worth stealing:** the `NormalizedEntry`/`ActionType` schema (one event type, N agent CLIs) and the
`next_action` chain (pipelines + dependencies for free). Both are ~200 lines.

### A2. Conductor (conductor.build) — ✅ verified, closed source
**[VERIFIED]** Mac app + cloud, by **Melty Labs** (YC) — Charlie Holtz and Jackson de Campos. Drives
Claude Code / Codex / Cursor / OpenCode in parallel.

**Loop:** *workspace = unit of delegation, PR = unit of integration.* Setup script → agent → diff
review (inline comments become agent context) → **Checks tab** (git status + CI + deploys + todos) →
AI-drafted PR → Conductor watches GitHub Actions and fixes failing checks → merge → **archive** (an
archive script tears down external resources; chat is preserved). Linear issues can seed workspaces.
**Isolation:** git worktrees at `~/conductor/workspaces/<repo>/<workspace>`; **Conductor Cloud**
(0.78.0, Jul 2026) runs on **Vercel Sandbox microVMs** (8 vCPU/16GB, SSH, 4h idle sleep, 23h50m max).
Free local / $50 Pro / $60 per-user Teams.

**Worth stealing:** paired **setup + archive scripts** — workspace teardown as a first-class,
scriptable lifecycle hook (nobody else models the end of a workspace's life).

### A3. claude-squad (smtg-ai/claude-squad) — ✅ alive
**[VERIFIED]** 8.3k★, AGPL-3.0, Go TUI. Active as of Jul 2026.
Statuses are minimal: `Running | Ready | Loading | Paused` (Paused = worktree removed, branch kept).
**Isolation:** `tmux new-session -d -s <name> -c <workdir> <program>` per instance, one git worktree per
session under `~/.claude-squad/worktrees/<sanitized-branch>_<nanotime>`. State is a flat JSON blob, not
a DB:

```
InstanceData{Title, Path, Branch, Status, Program,
  Worktree: GitWorktreeData{RepoPath, WorktreePath, BranchName, BaseCommitSHA, IsExistingBranch},
  DiffStats{Added, Removed, Content}}
```

**HITL:** review diff in-pane, checkout before push, `gh` for PRs; `-y/--autoyes` blanket auto-accept.
**Observability:** tmux pane capture polled by a monitor that flips status; ± diff stats per instance.
**Worth stealing:** `BaseCommitSHA` + `IsExistingBranch` — cheap, correct worktree lifecycle that never
eats a user's pre-existing branch.

### A4. claude-flow → **renamed to Ruflo** (ruvnet/ruflo)
**[VERIFIED]** 68.2k★, MIT, TypeScript — most-starred in the survey, and the highest
marketing-per-line-of-code. Self-describes as "an agent **meta-harness** for Claude Code and Codex":
98 agent definitions, 60+ slash commands, MCP server, hooks, a daemon, all written into `.claude/` and
`.claude-flow/` by `npx ruflo init`. "Swarms"/"hive-mind" are prompt-and-hook orchestration over
Claude Code subagents — **no OS- or git-level isolation, no worktrees, no containers.**

Its real substance is the memory layer, which *is* worth copying:
```sql
CREATE TABLE IF NOT EXISTS memory_entries (id TEXT PRIMARY KEY, key TEXT NOT NULL, content TEXT NOT NULL,
  type TEXT, namespace TEXT, tags TEXT, metadata TEXT, owner_id TEXT, access_level TEXT,
  created_at INTEGER, updated_at INTEGER, expires_at INTEGER, version INTEGER,
  "references" TEXT, access_count INTEGER, last_accessed_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_embeddings (entry_id TEXT PRIMARY KEY, embedding BLOB, ...);
CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, content, tokenize='porter unicode61');
```
**Worth stealing:** namespaced cross-session memory with TTL (`expires_at`), versioning, and hybrid
FTS5 + vector recall — a good shape for the documenter/librarian's wiki index. Ignore the swarm rhetoric.

### A5. ccmanager (kbwo/ccmanager) — ✅ alive, actively maintained
**[VERIFIED]** 1.2k★, MIT, Ink/TypeScript. Last push Aug 2026. Manages sessions across worktrees **and
multiple projects**. Positions explicitly against claude-squad: **no tmux dependency** (self-contained
PTY), per-session state in the menu — `idle | busy | waiting` — produced by a per-agent **state
detector** module (claude, codex, gemini, cursor, cline, copilot, opencode, kimi, mcode) that parses
terminal output.
**Isolation:** git worktrees (create/merge/delete in-app, submodule-aware) plus **devcontainer
integration** — manager stays on the host, sessions run in the container via `--devc-up-command` /
`--devc-exec-command`.
**HITL:** **status-change hooks** (shell commands fired on state transitions) and an experimental
**Auto Approval** using an AI verifier to auto-accept safe prompts. Copies Claude Code session data
between worktrees to preserve conversation context.
**Worth stealing:** status hooks + the pluggable per-agent state detector — the cheapest way to answer
"which agent needs me right now?" across heterogeneous CLIs.

### A6. Crystal (stravu/crystal) — ⚠️ DEPRECATED Feb 2026 → Nimbalyst
**[VERIFIED]** 3.1k★, MIT, TypeScript/Electron; last push Feb 2026; successor `Nimbalyst/nimbalyst`
(1.5k★) keeps worktree isolation and adds multi-editor local-first workspaces.
Crystal's schema remains the instructive part:

```sql
sessions(id, name, initial_prompt, worktree_name, worktree_path, status DEFAULT 'pending',
         last_output, exit_code, pid, claude_session_id)
execution_diffs(id, session_id, prompt_marker_id, execution_sequence, git_diff, files_changed,
  stats_additions, stats_deletions, stats_files_changed,
  before_commit_hash, after_commit_hash, timestamp)
```

Worktrees are literally `git worktree add -b <branch> "<path>" <baseRef>`. A later migration added
`panel_id` across all tables to support multiple agent panels per session.
**Worth stealing:** **`execution_diffs`** — a diff snapshot *per prompt*, keyed to a prompt marker, with
before/after commit hashes. That answers "what did *this instruction* actually change," which nothing
else in the category models. For a swim-lane UI this is the missing link between a phase and a diff.

### A7. agent-of-empires — ✅ verified, healthy
**[VERIFIED]** 3.1k★, MIT, Rust. TUI + web dashboard (PWA, mobile-first) for 10+ agents; started by
Nate Brake, 60+ contributors.
**Three-layer isolation: git worktrees + one tmux session per agent + optional Docker/Podman/Apple
Containers sandboxing with shared auth volumes.** Sessions survive TUI exit and SSH drop. States:
running / waiting / idle, with sound + push notifications. In-TUI diff viewer; the web "structured
view" renders plan panels and tool-call cards with **swipe-to-approve on mobile**. No kanban columns.
**Worth stealing:** tmux-as-durability (agents keep running when the UI dies) and phone-based approval
as the HITL surface.

### A8. Kilo Code (Kilo-Org/kilocode) — ✅ alive, **and it deleted Orchestrator mode**
**[VERIFIED]** 26.9k★, MIT, TypeScript. Now VS Code + JetBrains + CLI (`@kilocode/cli`), 500+ models at
provider pricing. Superset fork in the Cline → Roo Code → Kilo lineage.
**The 2026 change:** modes were renamed to **Agents** (`.kilo/agents/*.md`) and **Orchestrator mode was
deprecated** — Code/Plan/Debug agents now delegate to subagents automatically. The old v5.x
Orchestrator prompt survives only in `legacy-migration/native-mode-defaults.ts`, and it is the best
written subtask-handoff contract found anywhere in this survey:

> "use the `new_task` tool to delegate… These instructions must include: all necessary context from the
> parent task…; a clearly defined scope…; an explicit statement that the subtask should *only* perform
> the work outlined…; an instruction to signal completion by using the `attempt_completion` tool,
> providing a concise yet thorough summary… **keeping in mind that this summary will be the source of
> truth** used to keep track of what was completed… A statement that these specific instructions
> supersede any conflicting general instructions."

**Isolation:** none beyond the VS Code workspace — it edits your working tree in place, which
disqualifies it as a factory backend. **HITL:** per-tool auto-approve toggles, inline diff approval.
No kanban or background-agent queue.
**Worth stealing:** that delegation contract verbatim — scope + context + "summary is the source of
truth" + instruction precedence.

### A9. The rest of the category

| Project | ★ | Lic/Lang | Model |
|---|---|---|---|
| **Untrivial-ai/agent-orchestrator** (ex-ComposioHQ) | 9.6k | Apache-2.0, Go/TS | Biggest in category. Kanban columns are **derived, not set**: Working / Needs you / In review / Ready to merge, computed from session + PR + CI + review facts. Worker = "one task, one agent, one isolated workspace" (branch + worktree; "branchless directories" for scratch). Project-level orchestrator plans and spawns workers; autonomously fixes CI and merge conflicts. 26 agents. |
| **Emdash** (generalaction) | 5.4k | TS, YC W26 | Open-source ADE, parallel agents, any provider |
| **AutoMaker-Org/automaker** | 3.2k | MIT, TS | Closest to a true factory: **Backlog → In Progress → Waiting Approval → Verified**; moving a card to In Progress auto-assigns an agent; default 3 concurrent; **task dependencies block execution**; "Spec" mode spawns an agent per subtask. Worktree per feature + optional Docker with no host FS access. WebSocket streaming, per-feature `agent-output.md`. Built on the Claude Agent SDK. |
| **coder/mux** | 2.0k | AGPL-3.0, TS | By Coder Technologies. **Runtime as a per-task dropdown: Local / Worktree / SSH-remote.** Plan/Exec modes, git-divergence view with cross-workspace conflict detection, dedicated **costs tab** (tokens + spend). Coinbase reports 600+ users; power users merge 3.5× more PRs. |
| **saltbo/agent-kanban** | 448 | FSL-1.1-ALv2, TS | Todo→In Progress→In Review→Done. **Leader agents** assign + review/merge; **worker agents** claim tasks via atomic race-free claims; a daemon polls, sets up worktrees, spawns a worker per task, auto-completes on merge. Ed25519 identity per agent session; dependency cycle detection; stale-agent detection at 2h; SSE board; human↔agent chat per task. |
| **devflowinc/uzi** | 581 | Go | CLI for N parallel agents over worktrees |
| **MrLesk/Backlog.md** | 6.5k | TS | Git-native markdown task board for human + agent collaboration |
| **DanWahlin/ai-agent-board** | 57 | TS | Drag-drop kanban → Copilot/Claude/Codex/OpenCode, streaming, worktrees |

Long tail catalogued in `andyrewlee/awesome-agent-orchestrators` (mostly <100★, individually
unverified): openkanban, octomux (kanban fleet view + unified permission inbox), vibe-tree, jean, diri,
constellagent, supacode, clave, Tempest, Alethe, agent-deck, qm.

### A10. Deaths, pivots, and the lessons in them
- **Terragon is dead** — shut down 2026-01-16, code released Apache-2.0 as `terragon-labs/terragon-oss`
  (~257★): Postgres + Redis + WebSocket + Docker-sandbox task orchestrator. **The most liftable
  full-stack reference in the survey.**
- **Sculptor (imbue-ai/sculptor, MIT, Python, ~218★)** reversed from "each agent in its own Docker
  container" to **worktrees-first, containers experimental**. This is the clearest signal in the
  category about where the cost/benefit actually lands for local work. Its **"Pairing Mode"**
  bidirectionally syncs an agent's work into your local IDE so you can *run* the code without merging.
- **Omnara (Apache-2.0, Go, 2.7k★)** pivoted from phone-control-for-Claude-Code to **durable execution**:
  agent state atomically checkpointed to Postgres, surviving crashes and disconnects; machines can be
  added mid-run; pluggable sandboxes (Blaxel/Daytona/Unikraft).
- **Charlie (charlielabs.ai)** — closed source, Linear/GitHub-native. Its 2026 **"Daemons"** are
  always-on roles defined as plain `.md` files with deny rules and hybrid cron + event triggers.
- **HumanLayer / CodeLayer** — repo (11.3k★) now says "pretty much all deprecated"; rebuild at
  humanlayer.com. **No evidence of an acquisition** despite the rumour. But their **QRSPI phase-gate
  workflow** and Dex Horthy's *Advanced Context Engineering for Coding Agents* (2025-08-29) —
  **intentional compaction**, holding context utilization at **40–60%** by distilling structured
  artifacts at every phase boundary — is the single most useful non-code artifact in this survey.
- **Async (async.build)** exists but is waitlist-gated with no public docs — low confidence.

**[UNCONFIRMED]** Async's isolation/pricing/GA status; Charlie's sandbox mechanism; the HumanLayer
acquisition rumour; exact star counts in the sub-100★ long tail.

---

## Section B — Spec-driven development & planning-first workflows

*(Star counts are point-in-time from the GitHub API on 2026-08-18 as reported by the research pass.)*

### B1. AWS Kiro — ✅ GA, closed source
Preview Jul 2025 → **GA 2025-11-17** (https://kiro.dev/blog/general-availability/). The `kirodotdev/Kiro`
repo is issues + docs only; AWS VP Deepak Singh: *"We are not open sourcing the harness."*
Credit-metered pricing (Free 50 → Power $200/10,000 credits/mo; overage $0.04/credit, no rollover).
Credits burn on vibe prompts, spec prompts, spec refinement, task execution, **and hook execution**.
Amazon Q Developer is being sunset in Kiro's favour.

**Artifacts:** `.kiro/specs/{feature-name}/` holding `requirements.md`, `design.md`, `tasks.md`.
Requirements use **EARS** inside user stories:
```md
### Requirement 1
**User Story:** As a [role], I want [feature], so that [benefit]
#### Acceptance Criteria
1. WHEN [event] THEN [system] SHALL [response]
2. IF [precondition] THEN [system] SHALL [response]
```
`design.md` has a **fixed section list**: Overview, Architecture, Components and Interfaces, Data
Models, Error Handling, Testing Strategy (Mermaid encouraged). `tasks.md` is a two-level numbered
checkbox list with each task back-referenced to requirements: `_Requirements: 2.1, 3.3, 1.2_`.

**Gates:** hard human approval between *every* phase via a `userInput` tool with fixed reason strings
(`spec-requirements-review`, `spec-design-review`, `spec-tasks-review`) — *"MUST NOT proceed… until
receiving clear approval."* A **Quick Spec** mode skips all three. Execution is per-task ("Start task";
*"execute ONE task at a time… then stop"*); GA added **Run all Tasks** which builds a dependency graph
and runs independent tasks in concurrent waves. Status is the markdown checkbox, not an enum.

**Hooks:** `.kiro/hooks/<name>.json` —
`{version, hooks[].{name, trigger, matcher, action.{type:"command"|"agent", command|prompt}, timeout, enabled, confirm}}`;
triggers `PostFileSave|PostFileCreate|PostFileDelete|PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|Stop|PreTaskExec|PostTaskExec`.
**Steering:** `.kiro/steering/*.md`, auto-generated trio `product.md / tech.md / structure.md`,
frontmatter `inclusion: always|fileMatch|manual|auto` + `fileMatchPattern`, file refs
`#[[file:api/openapi.yaml]]`. Aug 2026 added nested `AGENTS.md` for directory-scoped steering.

**2026 additions:** Kiro Autonomous Agent (sandboxed, clones repos, opens PRs, ≤10 concurrent tasks),
**Kiro Crew** (Aug 2026 — persistent multi-agent workspace with cron/heartbeat and cross-session
memory, **Apache-2.0**, https://github.com/kirodotdev/KiroCrew), Kiro CLI 2.0 headless mode for CI,
property-based testing derived from EARS requirements, checkpoints, "Powers" plugin bundles.
**Worth stealing:** EARS acceptance criteria + per-task requirement back-refs; the fixed `design.md`
section list (a design doc with a fixed skeleton is reviewable at a glance).

### B2. github/spec-kit — ✅ MIT, Python, ★130,168, v0.16.4 (2026-08-14), pushed daily
Commands are now namespaced `/speckit.*`: **constitution, specify, clarify, plan, tasks, implement,
analyze, checklist, converge, taskstoissues**. `converge` is new — it diffs the codebase against
spec/plan/tasks and *appends the unbuilt remainder* to tasks.md. `taskstoissues` writes GitHub issues
via the GitHub MCP server.

**Layout:** `specs/[###-feature]/{spec.md, research.md, data-model.md, quickstart.md, contracts/,
plan.md, tasks.md}`; the active feature is tracked in `.specify/feature.json`, **not the git branch**
(git branching is now an opt-in extension).

**spec.md template:** `## User Scenarios & Testing` with prioritized (P1/P2/P3) *independently
testable* user stories, each with `**Given** … **When** … **Then**` scenarios; `### Edge Cases`;
`## Requirements` with `- **FR-001**: System MUST …` and inline `[NEEDS CLARIFICATION: …]` markers;
`### Key Entities`; `## Success Criteria` with `- **SC-001**: [measurable, technology-agnostic
metric]`; `## Assumptions`.
**tasks.md format:** `` `[ID] [P?] [Story] Description` `` — `[P]` = parallelizable, `[Story]` = US1/US2;
phases are Setup → Foundational (blocking) → per-user-story → Polish. `/speckit.implement` marks tasks
`[X]` as it goes and halts on "no"/"wait"/"stop". `plan.md` carries a `## Constitution Check` gate.

**New in 2026 — a declarative workflow engine** in `workflows/speckit/workflow.yml` with explicit
human gates:
```yaml
steps:
  - id: specify
    command: speckit.specify
  - id: review-spec
    type: gate
    message: "Review the generated spec before planning."
    options: [approve, reject]
    on_reject: abort
```
Plus `extensions/`, `presets/`, `bundles/`, and layered template resolution (project overrides →
presets → extensions → core). ~20 agent integrations. **No isolation, no observability** — it is a
prompt/template toolkit. Thoughtworks Radar: **Assess**, Apr 2026.
**Worth stealing:** the `type: gate` workflow step; `[P]`/`[Story]` task tagging; `converge` as a
drift-reconciler between spec and code.

### B3. BMAD-METHOD — ✅ MIT-ish (repo reports NOASSERTION), JS, ★52,042, **v6.11.0 (2026-08-10)**
**The widely-cited v4 description is obsolete.** v6 is rebuilt around Claude-style Skills and modules
registered in `bmad-modules.yaml`: `bmm` (default), `core`, `bmb` (Builder), `cis`, `tea` (Test
Architect), `bmad-loop` (unattended epic builder), `gds`.

Only **five personas** ship in BMM: Mary/Analyst, John/PM, Sally/UX, Winston/Architect, Amelia/Senior
SWE. PO, Scrum Master, QA and Orchestrator are gone *as agents* — SM became
`bmad-create-epics-and-stories` + `bmad-sprint-planning`, QA became `bmad-code-review`, orchestrator
became `bmad-party-mode`. **Doc sharding was removed in v6.11**, replaced by a cached compiled
`epic-<N>-context.md`.

Agent definition is `SKILL.md` + `customize.toml`:
```toml
[agent]
name = "Amelia"
title = "Senior Software Engineer"
principles = [ "No task complete without passing tests.", "Red, green, refactor — in that order." ]
[[agent.menu]]
code = "BD"
skill = "bmad-build"
```

The story file is replaced by a **spec** with frontmatter:
```yaml
status: 'draft' # draft | ready-for-dev | in-progress | in-review | done
review_loop_iteration: 0
```
Sections: Intent · **Boundaries & Constraints (Always / Ask First / Never)** · I/O & Edge-Case Matrix ·
Code Map · Tasks & Acceptance · Spec Change Log · Review Triage Log · Verification.
Target **900–1300 tokens; "Above 1600 = high risk of context rot."** Intent is wrapped in
`<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">`.
Sprint statuses: `backlog / ready-for-dev / in-progress / review / done`.

Flow: brief → PRD → UX/architecture (`ARCHITECTURE-SPINE.md`) → epics+stories → **readiness gate
(PASS/CONCERNS/FAIL)** → `bmad-build` → `bmad-code-review`. `bmad-build` **HALTs** on a dirty tree,
wrong branch, multi-goal scope, or unanswered questions. No isolation, no trace DB.
**Worth stealing:** the **frozen human-intent block**, the **Always / Ask First / Never** constraint
tiers, and a **hard token budget on the spec** — all three are cheap and directly applicable to your
Designs object.

### B4. claude-task-master / "Taskmaster" — ✅ MIT + Commons Clause, JS/TS, ★28,003
Now a **Hamster** (tryhamster.com) product; last repo commit Apr 2026, not archived, 212 open issues —
GitHub activity is slowing while docs moved to the vendor site.
`.taskmaster/tasks/tasks.json` is **tag-scoped**:
```json
{ "master": { "tasks": [ { "id": 1, "title": "…", "description": "…",
  "status": "done", "dependencies": [], "priority": "high",
  "details": "…", "testStrategy": "…", "previousStatus": "in-progress" } ],
  "metadata": { "created": "…", "updated": "…", "description": "Main tag for the taskmaster project" } } }
```
Zod contract: `TaskStatusSchema = z.enum(['pending','in-progress','blocked','done','cancelled','deferred'])`
(runtime `TaskStatus` adds `'review'|'completed'`); `TaskPriority = low|medium|high|critical`;
`TaskComplexity = simple|moderate|complex|very-complex`. Subtasks require `details` ≥20 chars.
Tasks carry rich AI-guidance metadata:
`relevantFiles[{path, description, action:'create'|'modify'|'reference'}]`, `codebasePatterns`,
`existingInfrastructure`, **`scopeBoundaries{included, excluded}`**, `implementationApproach`,
`acceptanceCriteria`, `category`.

Loop: `parse-prd` → `analyze-complexity` (1–10 score + `expansionPrompt` + `recommendedSubtasks`) →
`expand-task` → `next-task` (dependency-aware) → `set-task-status`. **37 MCP tools.**
Two newer engines: an **autopilot state machine** —
`WorkflowPhase = PREFLIGHT|BRANCH_SETUP|SUBTASK_LOOP|FINALIZE|COMPLETE`, `TDDPhase = RED|GREEN|COMMIT`,
events `RED_PHASE_COMPLETE / GREEN_PHASE_COMPLETE / COMMIT_COMPLETE / ABORT`, per-subtask
`attempts`/`maxAttempts` — and a **`loop` command** with presets
`default|test-coverage|linting|duplication|entropy`, a `progressFile`, `iterations`, `sleepSeconds`,
and a **Docker `sandbox` flag**. Isolation: branch-per-task + optional Docker.
**Worth stealing:** the RED/GREEN/COMMIT subtask state machine, and **`scopeBoundaries.excluded`** — an
explicit "what this ticket is NOT" field is the cheapest anti-scope-creep device in the survey.

### B5. Archon (coleam00/Archon) — ✅ MIT, TypeScript, ★23,223, **v0.9.0 (2026-08-17)** — fully pivoted
**No longer** "command center + RAG + kanban." Now *"the first open-source harness builder for AI
coding"*: a Bun monorepo running a **YAML workflow engine** over SQLite (`~/.archon/archon.db`,
optional Postgres). **Every run gets its own git worktree**; optional container backend with
`write_back: approve|auto`. Workflows live at `.archon/workflows/**.yaml`; node kinds
`command|prompt|bash|script|loop|loop_group|approval|cancel|include|workflow`, each with
`id, depends_on, when, trigger_rule, model, isolation:'inherit'|'worktree', timeout`.

```ts
workflowRunStatus = ['pending','running','completed','failed','cancelled','paused'];
nodeState        = ['pending','running','completed','failed','skipped'];
triggerRule      = ['all_success','one_success','none_failed_min_one_success','all_done'];
```
HITL is first-class: an `approval:` node **pauses the run**, and
`loop: { until: APPROVED, interactive: true, gate_message: … }`. 19 bundled workflows
(`archon-idea-to-pr`, `archon-fix-github-issue`, `archon-piv-loop`…), a "Mission Control" dashboard and
a drag-drop Workflow Builder. The agent drives it through a Claude Skill and one tool, `manage_run`.
**Archon v1** (Supabase + pgvector, crawling, 16 MCP tools incl. `find_tasks`/`manage_task`/
`rag_search_knowledge_base`, kanban) is frozen on `archive/v1-task-management-rag`, with
`CREATE TYPE task_status AS ENUM ('todo','doing','review','done')`.
**Worth stealing:** a **resumable `approval` node inside a DAG** plus **per-node worktree isolation** —
this is the closest published design to what you're building, and `triggerRule` is a genuinely useful
enum (Airflow-style) you'd otherwise reinvent.

### B6. Ralph Wiggum loop — see §F2 for the technique; ecosystem status here
Original post 2025-07-14, https://ghuntley.com/ralph/. Rules worth quoting: **"One item per loop. I
need to repeat myself here—one item per loop"**; *"Before making changes search codebase (don't assume
not implemented)"*; *"DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL
IMPLEMENTATIONS."*; subagent fan-out for search but *"Only 1 subagent for build/tests"*; `fix_plan.md`
as the persistent backlog. Claimed economics: a $50k contract delivered for **$297**.

**Dec 2025: Anthropic shipped an official `ralph-wiggum` plugin** in `anthropics/claude-code` —
`/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"` and `/cancel-ralph`, using a
**Stop hook** to intercept exits instead of an external bash loop; termination = exact-string completion
promise or the iteration cap. Claude Code's built-in `/loop`, `/goal`, `/batch` now cover similar
ground. Huntley is critical of it ("dies in cryptic ways", misses carving work into independent context
windows). Verified derivatives: `mikeyobrien/ralph-orchestrator` (★3,101, MIT, Rust),
`michaelshimeles/ralphy` (★2,957), `Th0rgal/open-ralph-wiggum` (★1,881), `tzachbon/smart-ralph` (★514 —
Ralph + spec-driven + compaction), `coleam00/ralph-loop-quickstart` (★159), `eduardolat/clancy` (★119, Go).
**Worth stealing:** one-item-per-loop + file-based memory; **the completion-promise / max-iterations
pair as the only two exits** (a loop with exactly two termination conditions is auditable).

### B7. SSSF's sequel: "Factory In A Box" — the isolation layer SSSF lacks
**[VERIFIED]** https://github.com/disler/inkwell-agent-sandboxes-and-software-factory (★122, Aug 2026).
Three nested tiers: out-sandbox orchestrator on your host → in-sandbox Claude Code orchestrator → ADW
agents. Six host phases — **create, fill, setup, execute, observe, teardown** — standing up a
disposable VM in ~10s. **Per-run API key capped at $50 and revoked at teardown** — *"one level of
nesting, enforced by credentials rather than by deleting files."* Best-of-N fan-out = one prompt × N
rosters × N boxes. **Harvest never merges**: commits come home as **`refs/sandbox/<run-id>`** for a
human to compare; teardown is never automatic.
**Worth stealing:** budget-capped ephemeral credentials as the sandbox boundary, and
`refs/sandbox/<run-id>` harvest-without-merge — both are small, and both solve real problems
(runaway spend; N competing implementations to compare).

Also: `disler/claude-code-hooks-multi-agent-observability` (★1,519) —
hooks → HTTP → Bun → SQLite → WebSocket → Vue, with
`HookEvent{source_app, session_id, hook_event_type, payload, chat, summary, model_name}` and now a
**`HumanInTheLoop{question, type:'question'|'permission'|'choice', choices, timeout}`** record with
status `pending|responded|timeout|error` — a ready-made HITL event schema.
And `disler/infinite-agentic-loop` (★611) — `/project:infinite <spec_file> <output_dir> <count>`,
parallel sub-agents in waves of 5 until context exhausts.

### B8. Other spec tooling
- **OpenSpec** (`Fission-AI/OpenSpec`) — MIT, TypeScript, **★65,402**, v1.9.0. The sleeper giant;
  Thoughtworks Radar **Assess**, Apr 2026. New **OPSX** workflow: *artifacts, not phases*
  (`proposal → specs → design → tasks → implement`, dependencies as "enablers, not requirements").
  Layout `openspec/changes/<id>/{proposal.md, specs/**/spec.md, design.md, tasks.md}`, archived to
  `changes/archive/<date>-<id>/`. **The workflow itself is data** — `schemas/spec-driven/schema.yaml`
  declares `artifacts[].{id, generates, template, instruction, requires}`, so you edit the prompt, not
  the package. Specs are **delta documents**:
  `## ADDED / MODIFIED / REMOVED / RENAMED Requirements`, `### Requirement: <name>` (SHALL/MUST),
  `#### Scenario: <name>` with `- **WHEN** … - **THEN** …` — *"Scenarios MUST use exactly 4 hashtags.
  Using 3 hashtags or bullets will fail silently."* `openspec validate` rejects a zero-delta change.
  **Stores** (beta) put `openspec/` in its own repo for cross-repo planning. Explicitly *"built for
  brownfield not just greenfield."* **Worth stealing:** specs as *deltas* against a living baseline —
  this is the single best answer to "what does a Design object contain on ticket #400?"
- **buildermethods/agent-os** — MIT, ★5,297, **v3.0 (Jan 2026)**, quiet since May 2026. v3 deliberately
  **retreated** from orchestration: *"Spec writing — now best handled using Plan mode. Task breakdown —
  tools like Claude Code automatically create todo lists."* It now does only standards
  (`/discover-standards`, `/index-standards`, `/inject-standards`, `/plan-product`, `/shape-spec`).
  **A useful negative data point about what the harness layer should stop owning.**
- **Tessl** (tessl.io) — Guy Podjarny (Snyk founder), **$125M raised**. Tessl Framework (specs as
  long-term memory, incl. AI-generated "vibe-specs") + **Tessl Spec Registry** (10,000+ pre-built
  library specs to stop API hallucination) + (May 2026) an agent-**skills** package manager with
  quality evals. Spec files like `dynamic-data-renderer.spec.md` with `@generate`/`@test` tags producing
  `// GENERATED FROM SPEC - DO NOT EDIT` code. The only true "spec-as-source" product here.
  **[PARTIAL]** — GA/pricing not verified firsthand.
- **The discourse.** Birgitta Böckeler, *Understanding SDD: Kiro, spec-kit, Tessl*
  (https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html, Oct 2025) is the reference
  framing — three levels: **spec-first**, **spec-anchored**, **spec-as-source** — warning that
  spec-as-source may inherit *"inflexibility and non-determinism"* from both MDD and LLMs, and adding
  *"I'd rather review code than all these markdown files."* Thoughtworks put SDD in Assess (Nov 2025)
  and Spec Kit in Assess (Apr 2026), noting most experiments are **brownfield** and that experienced
  engineers extract the most value. Sharpest critique: Scott Logic's *"Radical Idea or Reinvented
  Waterfall?"* — a plan phase emitting 2,000+ lines of markdown, with a reviewer *"around ten times
  faster"* using plain iterative prompting. Best rebuttal (Marc Brooker, Apr 2026): if
  spec-before-implementation makes it waterfall, TDD's failing test is waterfall too.

---

## Section C — AI-native issue trackers & ticket→agent assignment

### C1. Beads (`bd`) — ✅ git-backed issue graph for agents — **repo moved**
Now **`gastownhall/beads`** (`steveyegge/beads` redirects; Go module path still
`github.com/steveyegge/beads`). ★26,436, Go, MIT, created 2025-10-12, pushed 2026-08-18.
Docs: https://beads.gascity.com

⚠️ **Correction to the common description: the JSONL + SQLite model is historical.** At v1.0 (early
2026) Beads moved to **Dolt** (a version-controlled SQL database); `bd migrate --to-dolt` was *removed*
in v0.58.0. Data lives in `.beads/embeddeddolt/` (embedded, single-writer file lock) or against a
`dolt sql-server` (default `127.0.0.1:3307`) for orchestrator setups. Sync is `bd dolt push/pull`
against DoltHub/S3/GCS/git+ssh using **`refs/dolt/data`** — separate from git refs, so issue data can
safely co-locate in the source repo. **One Dolt commit per write command** in embedded mode. JSONL
survives only as interchange (`bd export`) and the docs warn it *"do[es] not capture Dolt branches,
full commit history, working-set state, or non-issue tables."*

**Issue schema** (verbatim from `0001_create_issues.up.sql`, now 65 migrations deep): `id`,
`content_hash`, `title`, `description`, `design`, `acceptance_criteria`, `notes`, `status`, `priority`,
`issue_type`, `assignee`, `owner`, `estimated_minutes`, `created_at/by`, `updated_at`, `closed_at`,
`closed_by_session`, `external_ref`, `spec_id`, `compaction_level`, `compacted_at`, `original_size`,
`ephemeral`, `wisp_type`, `pinned`, `is_template`, `mol_type`, `work_type` (default `'mutex'`),
`source_system`, `source_repo`, `metadata JSON`, `close_reason`, `agent_state`, `last_activity`,
`role_type`, `rig`, `due_at`, `defer_until`.

**Status enum:** `open, in_progress, blocked, deferred, closed, pinned, hooked` (*"work actively
claimed by a worker"*). **Types:** `bug, feature, task, epic, chore, decision, message, molecule, gate,
spike, story, milestone, event`.

**19 dependency types**, grouped verbatim in `internal/types/types.go`:
```go
// Workflow (affect ready work): blocks, parent-child, conditional-blocks, waits-for
// Association:                  related, discovered-from
// Graph links:                  replies-to, relates-to, duplicates, supersedes
// Entity (HOP):                 authored-by, assigned-to, approved-by, attests
// Convoy:                       tracks
// Reference:                    until, caused-by, validates
// Delegation:                   delegated-from
```
`conditional-blocks` ("B runs only if A fails") and `waits-for` ("fanout gate: wait for dynamic
children") are notable additions beyond the original four.

**Ready work is a SQL view, not a heuristic.** `ready_issues` uses a recursive CTE: direct blockers
(`type='blocks'` with blocker not in `('closed','pinned')`), transitively inherited down `parent-child`
edges to depth 50, minus ephemeral issues, minus `defer_until > UTC_TIMESTAMP()`, plus deferred-parent
exclusion. **`bd ready --claim` atomically claims the first matching issue** (sets assignee +
`in_progress`), with a leases table carrying `lease_expires_at`, `heartbeat_at`, and
`lease_granted_node` so a lease is only enforceable on the replica that granted it.
`bd ready --explain` prints dependency-aware reasoning.

**Compaction is two different things.** `bd compact` = Dolt commit squashing. **`bd admin compact` =
semantic memory decay**: Tier 1 = "Semantic compression (30 days closed, 70% reduction)". Modes:
`--analyze` (export candidates as JSON for the agent to summarize), `--apply --id bd-42 --summary -`
(accept an agent-written summary), `--auto`. *"This is permanent graceful decay — original content is
discarded."*

**Agent surface:** `bd init` **writes/updates `AGENTS.md` by default**; `bd setup
codex|claude|factory|cursor|mux` installs skills/hooks. `bd prime` injects workflow context +
persistent memories; `bd remember "insight"` stores them. MCP server is a separate Python package
(`beads-mcp`) exposing `beads_ready_work`, `beads_claim_issue`, `beads_add_dependency`, `beads_blocked`…
Bidirectional sync adapters for **Linear, GitHub, Jira, GitLab, Notion, Azure DevOps**.
Ecosystem: Yegge's Medium series; **Gas Town** (his Beads-based multi-agent orchestrator, open-sourced
2026-01-01, v1.0 Apr 2026, same `gastownhall` org); "Gas City" as an SDK re-decomposition.
**Worth stealing:** readiness as a **persisted projection** (`is_blocked` column) recomputed by
migration rather than guessed at query time; atomic `--claim` with lease + heartbeat + granting node;
and `AGENTS.md` written by the tool at `init` so agent onboarding is a side-effect of installation.

### C2. Linear — Agents, Agent Sessions, delegation
Still **"Developer Preview."** Key semantic shift: **"Assigning an issue to your app now sets it as the
`delegate`, not the `assignee`"** — `Issue.delegate: User`; the human assignee retains ownership.
Agents authenticate via OAuth `actor=app` with `app:assignable` / `app:mentionable` scopes.

**Data model (verbatim from the SDK `schema.graphql`):**
```graphql
enum AgentSessionStatus { active  awaitingInput  complete  error  pending  stale }
enum AgentActivityType { action  elicitation  error  prompt  response  thought }
enum AgentActivitySignal { auth  continue  select  stop }
union AgentActivityContent =
    AgentActivityActionContent | AgentActivityElicitationContent | AgentActivityErrorContent
  | AgentActivityPromptContent | AgentActivityResponseContent   | AgentActivityThoughtContent
```
`ActionContent { action: String!  parameter: String!  result: String  resultData: JSONObject }`;
thought/elicitation/response share `{ body: String!  bodyData: JSONObject! }`; error adds `reasonCode`.
`AgentActivity.ephemeral: Boolean!` (only `thought`/`action` may be ephemeral). **Agents cannot emit
`prompt`** — that is user-generated. `AgentSession` carries `issue`, `comment`, `pullRequest(s)`,
`plan: JSON`, `externalLinks`, `summary`, `context`, `workspaceDiff`, `dismissedAt` (*"When dismissed,
the agent is removed as delegate from the associated issue"*).

**Webhook:** header `Linear-Event: AgentSessionEvent`, **two actions only — `created` and `prompted`**.
Payload: `action, agentActivity, agentSession, appUserId, guidance: [GuidanceRuleWebhookPayload!],
oauthClientId, organizationId, previousComments, promptContext, webhookId, webhookTimestamp`.
*"You must return a response from your webhook receiver within 5 seconds."*

**Two hard timers, verbatim:** *"The first response must be sent within 10 seconds of receiving the
`created` event, or the agent will be shown as unresponsive. Follow-up activities … can still be sent
for up to 30 minutes before the session is considered stale."* Stale is recoverable.
**Linear tracks status automatically "based on the last emitted activity"** — the agent never sets
`AgentSessionStatus` directly. **The agent moves the ticket**: it queries
`states(filter:{type:{eq:"started"}})` and moves the issue to the lowest-`position` started state; if an
*automation* delegated it, *"keep it in triage state and leave assignment up to a human actor."*
Mutations: `agentActivityCreate(agentSessionId, content, ephemeral, signal, signalMetadata)`,
`agentSessionCreateOnIssue/OnComment`, `agentSessionUpdate` (*"Only updatable by the OAuth application
that owns the session"*). Plans are `Array<{content, status:"pending"|"inProgress"|"completed"|"canceled"}>`,
replaced wholesale.

**HITL:** `elicitation` activity + `select` signal (`signalMetadata.options[{label,value}]`), `auth`
signal for account linking, `stop` signal (*"the agent must not perform any further actions"*).
Agent Interaction Guidelines, verbatim: *"An agent should always disclose that it's an agent" … "should
respect requests to disengage" … "An agent cannot be held accountable."*

**Directory (Aug 2026): 27 agents.** Featured: Codex, Cursor, GitHub Copilot, Factory, Sentry (Seer),
Devin. Long tail incl. Charlie, Cyrus, ChatPRD, Warp, Tembo, Ranger. **Claude/Claude Code is not listed
as an agent** (only an MCP connector); **Codegen's page now 404s** — delist vs. rename unconfirmed.
**"Agents are not counted as billable seats in Linear."** Linear's own first-party agent shipped
**coding sessions** (2026-06-11) using *"Claude Code and Codex"* in managed sandboxes, and **Loops**
(2026-07-20) for scheduled/event-triggered recurring agent work. Cost reporting (AI credits, prepaid
USD, workspace-pooled) covers **only Linear's own AI**, not third-party agents. Observability: session
cards in the issue feed, "Worked for X", Insights grouped by Delegate and session status. **No named
"agent inbox" surface exists.**
**Worth stealing:** **delegate ≠ assignee**; the six-value session status driven *by* activities rather
than set directly; the activity taxonomy `thought | action | elicitation | response | error` with
`ephemeral` on the noisy two; and the two hard timers.
URLs: https://linear.app/developers/agents · https://linear.app/developers/agent-interaction ·
https://linear.app/developers/aig · https://linear.app/developers/webhooks

### C3. OpenAI Symphony — ✅ **CONFIRMED REAL — and it's a spec, not a product**
Announced **2026-04-27** ("An open-source spec for Codex orchestration: Symphony").
**https://github.com/openai/symphony** — created 2026-02-26, **Apache-2.0, Elixir, ★26,744**, pushed
2026-08-12. It is a **2,312-line `SPEC.md` plus an experimental Elixir reference implementation**;
OpenAI states it does not plan to maintain Symphony as a standalone product. **No waitlist, no pricing,
no SKU called "agent manager."** The "Linear→Codex orchestrator" framing is shorthand — **Linear is
just an adapter**, and adapters implement only `fetch_issues_by_states` / `fetch_issues_by_ids`.

Normalized `Issue`: `id`, `native_ref` (opaque), `identifier` (`ABC-123`, names the workspace), `title`,
`description`, `priority` (lower = higher), `state`, `branch_name`, `url`, `assignee_id`, `labels`
(lowercased), `blocked_by`, **`dispatchable: boolean`**, `created_at`, `updated_at`.

Internal claim states — explicitly *"not the same as tracker states"*:
`Unclaimed → Claimed (Running | RetryQueued) → Released`.
Run-attempt phases: `PreparingWorkspace, BuildingPrompt, LaunchingAgentProcess, InitializingSession,
StreamingTurn, Finishing, Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation`.

**Who moves the ticket — §11.5, verbatim:**
> *"Ticket mutations (state transitions, comments, attachments, PR metadata) are typically handled by
> the coding agent through the selected adapter's provider-native tools… The service remains a
> scheduler/runner and tracker reader. Workflow-specific success often means 'reached the next handoff
> state' (for example `Human Review`) rather than tracker terminal state `Done`."*

Credentials never reach the child: *"Tools execute in Symphony with the configured adapter credential;
the child receives tool results, not a raw token."*
**Isolation:** deterministic per-issue workspace keyed on sanitized `identifier`, reused across
attempts, not auto-deleted on success. Three safety invariants: `cwd == workspace_path`; workspace must
be prefixed by workspace root; keys restricted to `[A-Za-z0-9._-]` with a ≥64-bit hash suffix on
collision. Concurrency `max(max_concurrent_agents - running_count, 0)`; failure backoff
`min(10000 * 2^(attempt-1), max_retry_backoff_ms)`. Approvals are implementation-defined but *"MUST NOT
leave a run stalled indefinitely."* OpenAI's own claim: **~500% increase in landed PRs in three weeks.**
**Worth stealing:** the **separation of *claim state* from *tracker state***, the run-attempt phase
enum, "success = reached the next handoff state," and orchestrator-never-writes-to-the-tracker.

**Also confirmed and distinct:** Codex's shipped **Linear integration** — assign a Linear issue to Codex
like a teammate or `@Codex`; triage rules can auto-assign; Codex opens a cloud chat, posts progress,
ends with a summary + link to create a PR. One-issue-one-chat; no orchestration loop.

### C4. Paperclip — ✅ CONFIRMED REAL — **but the domain in circulation is wrong**
`paperclip.ai` is an **unrelated automotive/HIL-powertrain company** — do not cite it. The real one is
**https://paperclip.ing** / **https://github.com/paperclipai/paperclip**: **MIT, TypeScript**, created
2026-03-02, **★78,826**, pushed 2026-08-19. Node.js server + React UI + embedded Postgres, self-hosted.
Tagline: *"If OpenClaw is an employee, Paperclip is the company."* Four pillars: Agentic Task Manager,
Org Chart for Agents, Agent Employee Training, Agentic OS.

```ts
ISSUE_STATUSES        = ["backlog","todo","in_progress","in_review","done","blocked","cancelled"]
ISSUE_PRIORITIES      = ["critical","high","medium","low"]
ISSUE_REVIEW_POLICIES = ["anyone","not_creator","human_only"]
ISSUE_WORK_MODES      = ["standard","ask","planning","skill_test"]
ISSUE_COMMENT_AUTHOR_TYPES = ["user","agent","system"]
issue_relations.type  = "blocks"   // only relation type
```
`issues` columns worth noting: `companyId, projectId, goalId, parentId`, **`assigneeAgentId` AND
`assigneeUserId` side by side**, `checkoutRunId`/`executionRunId` → `heartbeat_runs`,
`executionLockedAt`, `executionAgentNameKey`, `originKind`/`originId`/`originRunId`/`originFingerprint`,
`requestDepth` (max 1024), `billingCode`, `executionPolicy`/`executionState` JSONB,
`monitorNextCheckAt`/`monitorWakeRequestedAt`/`monitorAttemptCount`, `executionWorkspaceId`,
`sourceTrust`, `unblockDescriptor`, `blockedTransitionAt`, `blockedOwnerNotifiedAt`.
Sibling tables: `issue_approvals`, `issue_execution_decisions`, `issue_watchdogs`, `issue_tree_holds`,
`issue_work_products`, `issue_plan_decompositions`, `decision_queues`, `budget_policies`,
`budget_incidents`, `cost_events`, `execution_workspaces`, `environment_leases`.

**Loop:** agents wake on **heartbeats** (plus assignment/@-mention events), **atomically check out** an
issue under an execution lock (**checkout + budget enforcement are atomic** — "no double-work, no
runaway spend"), work in an execution workspace, and hit approval gates. `review_policy: human_only` is
the explicit HITL escape hatch. Per-agent monthly budgets pause the agent and cancel queued work on
breach. Cost tracked by company/agent/project/goal/issue/provider/model.
**[UNCONFIRMED]** funding, YC batch; founder is pseudonymous. "Bring-your-own-ticket-system
(Asana/Linear/Jira)" is on the roadmap, **not shipped**. A separate Estonian org `paperclipinc` sells a
€10/mo hosted control plane — **affiliation unresolved**.
**Worth stealing:** `review_policy ∈ {anyone, not_creator, human_only}` **as a field on every issue**;
atomic checkout-with-budget-enforcement in one transaction; `cost_events` keyed to the issue.

### C5. GitHub as the agent queue
**Copilot coding agent:** Copilot is a real assignee — bot login **`copilot-swe-agent[bot]`**. Assign via
UI, `gh`, REST (`POST /repos/{o}/{r}/issues/{n}/assignees`) or GraphQL (`replaceActorsForAssignable`).
Agent-assignment fields: REST `target_repo, base_branch, custom_instructions, custom_agent, model`.

**Agent Tasks API:** `POST /agents/repos/{owner}/{repo}/tasks` (`prompt` required; `base_ref`, `model`,
`create_pull_request` optional), `GET /agents/tasks`, `GET /agents/repos/{o}/{r}/tasks/{task-id}`.
**Task status enum: `queued, in_progress, completed, failed, idle, waiting_for_user, timed_out,
cancelled`.** ⚠️ User-to-server tokens only — **GitHub App installation tokens are not supported**,
which blocks a lot of pure-server orchestration. Execution is an ephemeral GitHub Actions environment
with an egress firewall; output is a draft PR; **the human moves the issue**. **No documented webhook
for agent sessions** — you observe via `pull_request` events on the bot's PRs.

**Agent HQ** (announced GitHub Universe Oct 2025): **mission control** = *"a single command center to
assign, steer, and track the work of multiple agents"* — not one destination but a surface across
github.com, VS Code, mobile, CLI — with branch controls, agent identity, merge-conflict resolution, and
Slack/Linear/Jira/Teams/Azure Boards integrations. Third-party agents (Anthropic, OpenAI, Google,
Cognition, xAI) ship inside a paid Copilot subscription. **Enterprise AI Controls + agent control plane
went GA 2026-02-26.**

**AGENTS.md:** formalized Aug 2025 (OpenAI + Google + Cursor + Factory + Sourcegraph), now **stewarded
by the Agentic AI Foundation under the Linux Foundation**. No mandated fields — plain Markdown, with
conventional sections (project overview, build/test commands, code style, testing, security, PR
instructions). **60,000+ non-fork non-archived repos**, 24+ tools with native support. https://agents.md/
**Worth stealing:** **`waiting_for_user` and `idle` as first-class task states** — most trackers force
HITL into a status hack; GitHub models it properly.

### C6. Other entrants, and the debunked ones
| Product | What it is | Status |
|---|---|---|
| **Sortie** | *"Turn tracker tickets into autonomous agent sessions"* | Go, Apache-2.0, ★127, created Mar 2026, active |
| **Charlie Labs** | AI teammate in Linear/GitHub/Slack; V2 is a **durable runtime** that "recovers from partial failures and follows through to merge"; "Daemons" watch PRs/CI/Sentry | Closed source; in Linear Agents since May 2025 |
| **Hiveship** | Agent-first tracker (see §F6) | **Early access + waitlist only** — marketing site is the sole source; treat as unverified |
| **AIDEN** | *"the feature cards on the board are the issues, and the board runs the agents"* | Single-source, **unverified** |
| **Height** (height.app) | The original "autonomous project management" tool | **DEAD — shut down 2025-09-24**, data deleted. Founded 2018, raised $18.3M. *A cautionary tale for this exact product category.* |
| **Tracecat** | Open-source **SOAR / security automation** | **Misidentified** — not an issue tracker |
| **Kosmik** | Infinite visual canvas / research tool | **Unrelated** to this cluster |

---

## Section D — Commercial / cloud autonomous coding agents

*Research note: the WebSearch budget was exhausted mid-pass; later verification came from direct doc
fetches. Items not confirmed against a primary source are marked **[UNVERIFIED]**.*

### D1. Devin (Cognition)
Category-defining hosted "AI software engineer," and thriving: **$1B+ Series D at $26B post
(2026-05-27)**, ~**$492M ARR** (May 2026, up from $37M a year earlier). Cognition claims **89% of its own
code is committed by Devin.** Current line **Devin 2.2** (2026-02-24) — 3× faster startup, full
desktop/computer-use testing. Secondary sources describe a "3.0"-era dynamic re-planning; **[UNVERIFIED]**.

**Triggers.** Web app; Slack (`@Devin`, with `!windows` / `!ultra` / `!fast` mid-session toggles); Teams;
**Linear** — assign an issue → default playbook, or labels `!plan` / `!implement` / `!review` select a
playbook, or an `@mention` overrides with your comment text; **Jira**; GitLab; CLI; v3 API; and
**Automations** — push events, files-changed triggers, cron/RRULE schedules, `snapshot_build:completed`,
webhooks, run-once. Automations gained **queueing + concurrency controls** (2026-08-07). Sessions carry
origin badges, archive/pin state, and folders.
**Parallelism.** **"Devin manages Devins"** (2026-03-19): a parent session orchestrates child sessions,
**each in its own isolated VM**, with structured output schemas and a parent/child tree in the sidebar.
**HITL.** Two-stage: **Ask mode** (read-only exploration + planning) → "Send to Devin" → **Agent mode**.
Plan mode keeps a persistent markdown plan at `~/.devin/plans/plan-<session>.md` and **asks for approval
before implementing when confidence is low**, proceeding when confident. Also: **network-access requests
with an approval workflow** (approvable from Slack), pre-approve-testing preference, queued messages,
and **Devin Review** with action-required flags plus auto-fix.
**Isolation.** Managed cloud VM per session with **snapshots/blueprints** (git-backed, versioned,
schedulable, revertible). The 2026 headline is **Devin Outposts** (2026-07-21): the agent loop
(inference + planning) stays in Cognition's cloud while **all command execution, file edits and repo
access run on your machines** — VMs, containers, Kubernetes (open-source `devin-outpost-k8s` operator),
macOS, GPU boxes. Workers need **outbound HTTPS only** — no inbound ports, public IPs, or VPN. N workers
= N concurrent sessions; extras queue.
**Observability.** Worklog with **streaming shell output and streaming terminals**, editor/browser/
planner tabs, **video recording + playback of test runs**, Mermaid rendering, **diff-line and message
permalinks**, session insights, consumption analytics, MCP audit logs.
**Failure/retry.** Snapshot-build failure recovery; Jira webhook reconnect; **sleeping sessions wake on
PR-comment retrigger**; pending reviews cancel on new commits.
**Cost.** ACUs = normalized VM time + inference + bandwidth; **~1 ACU ≈ 15 min of work**. Core $20 entry,
**$2.25/ACU** PAYG; Team $500/mo incl. 250 ACUs at $2.00. 2026 added **per-session ACU hard caps with an
acknowledgement modal** and a DeepWiki cost-breakdown modal (wiki: low free, **medium ~5–10 ACUs, high
~20–40**). Proprietary.
**Worth stealing:** the **Outposts split** — expensive stateful reasoning stays remote, all execution runs
locally over an outbound-only tunnel. It dissolves the "cloud agent vs. my infra" tradeoff.
https://docs.devin.ai/release-notes/2026 · /cloud/outposts/overview · /integrations/linear

### D2. Factory.ai (droids)
"The autonomy stack for enterprise teams." **The old departmental droid lineup is gone**; as of Aug 2026
the model is **Spec Mode, Missions, custom droids, skills, plugins, hooks, native worktrees, and
`droid exec`**. Customers listed include Blackstone, Adyen, Wipro, Groq, Chainguard.
**Triggers.** Factory App (desktop review workspace), **Droid CLI**, web + mobile, API/SDK. The
**Software Factory** doc frames six SDLC stages — triage, code-gen, validate, release, document
(AutoWiki), monitor — fed by GitHub events, Linear/Jira tickets, Slack, and schedules. The API exposes
Droid Sessions, CI Automations, Droid Computers, AutoWiki, Analytics, Readiness Reports.
**HITL — the hardest plan gate in this cluster.** **Missions**: the droid interrogates you on goals and
constraints, produces a milestone-structured plan, and **requires explicit approval before execution**;
post-approval the session enters **Mission Control** and you track progress against the plan. Factory is
openly skeptical of parallelism in its own docs (*"Running multiple agents in parallel sounds good in
theory, but does it actually produce better results?"*) — **Missions execute sequentially.**
**Isolation.** Deliberately not hosted-VM-only: droids run on laptops, CI, VMs, Kubernetes, air-gapped
networks; Droid Computers is the optional managed cloud. **Graded autonomy** in `droid exec`: default
**read-only** → `--auto low` (edit project files) → `medium` (installs/builds/tests/commits) → `high`
(remote writes, deploys, migrations) → `--skip-permissions-unsafe` (disposable containers only).
**Exceeding the level aborts immediately with a non-zero exit and no partial changes.** Parallel
isolation via `droid exec --worktree name-a|name-b`. SOC 2 Type II, ISO 27001, **ISO 42001**.
**Observability.** **OpenTelemetry metrics** from the agent plus hosted analytics. `droid exec` emits
text, JSON (`session_id`, `duration_ms`, `num_turns`, success/failure), or **stream JSON-RPC** driving the
full control surface over stdin/stdout. Sessions **resume** (`--session-id`) and **fork** (`--fork <id>`);
tags and log-group IDs aggregate related runs. ⚠️ `droid exec` JSON has **no token or cost fields** —
cost lives only in the dashboard/OTel.
**Pricing.** Pro $20 · Plus $100 · Max $200 · Business · Enterprise. Proprietary.
**Worth stealing:** the **autonomy ladder as a hard precondition** — refuse and exit non-zero *before*
acting rather than prompting mid-run. Makes unattended CI usage safe by construction.
https://docs.factory.ai/droid-exec/overview · /missions/overview · /software-factory/overview

### D3. OpenAI Codex cloud
Multi-surface: web, CLI, IDE extension, desktop, GitHub/Slack/Linear; >2M weekly actives (Mar 2026).
**The "GPT-5.x-codex" line is effectively retired** — Codex runs the general **GPT-5.6 Sol / Terra / Luna**
family (GA 2026-07-09, 1M context), default `gpt-5.6-sol` at medium reasoning; only **GPT-5.3-Codex-Spark**
keeps Codex branding. GPT-5.4/5.4-mini retire from Codex **2026-08-31**.
**Triggers.** Web **Code vs Ask** buttons; `codex cloud exec`; IDE "Run in the cloud"; **@Codex in Slack**
(reads thread history, auto-picks the best-matching environment, posts 👀 while working); **@Codex in
Linear**; GitHub `@codex review` / `@codex security review` / `@codex fix …`, plus per-repo auto-review on
every PR. Parallelism is bounded by credits, not a task count.
**HITL.** **No plan-approval gate** — fire-and-forget; steer via follow-up turns and PR comments. Review
behaviour is configured declaratively by a **`## Code Review Rules`** section in `AGENTS.md`.
**Isolation — the best-designed in the survey.** Container (`openai/codex-universal`, open-sourced).
**Two-phase network model**: internet ON during setup, **air-gapped during the agent phase** by default;
if egress is enabled it runs through a proxy with a **domain allowlist plus an allowed-HTTP-methods
restriction (GET/HEAD/OPTIONS only)**, so it structurally cannot POST-exfiltrate. **Secrets exist only
during setup and are stripped before the agent runs.** Container state cached 12h.
**Observability / cost.** Live logs, terminal worklog, summary + diff, session fork/archive/restore,
`/export` to Markdown, and **`/status` showing estimated thread credits/cost** (CLI 0.148.0, 2026-08-18).
Enterprise: analytics by surface *and* model, Compliance API (JSONL export), OTel→SIEM, RBAC.
**Failure/retry.** None orchestrated; relies on context compaction and human follow-up turns.
**Pricing / OSS.** Bundled in ChatGPT. Since **2026-04-02: token-based credits (~$0.04/credit) on a
rolling 5-hour window**; Sol = 125 in / 750 out credits per 1M tokens. OpenAI's own guidance:
**$100–200/dev/month**. **CLI is Apache-2.0**; `@openai/codex-sdk` wraps it; the CLI can run as an MCP server.
**Worth stealing:** the two-phase network policy — "cannot exfiltrate" as a *structural* property rather
than a prompt instruction.

### D4. Google Jules
Async coding agent, out of beta Aug 2025 — **but the official changelog's last entry is 2026-03-09**, Jules
went unmentioned at I/O 2026, and Gemini Code Assist for GitHub was killed 2026-07-17 in favour of
**Antigravity**. ⚠️ **Treat Jules as strategically at risk.**
**Triggers.** GitHub issue labelled `jules`; PR review comments (adds 👀 per comment and pushes fixes;
opt-in Reactive Mode narrows to `@Jules`); **Jules Tools CLI** (`npm i -g @google/jules`, TUI dashboard,
pipeable with `gh`/`jq`); **Jules API** (`v1alpha`: list sources → create session → **`:approvePlan`** →
poll activities → PR); `google-labs-code/jules-action`; Gemini CLI extension; scheduled tasks; proactive
suggested tasks; **CI Fixer**. **Concurrency is a plan tier: 3 / 15 / 60.**
**Plan approval — best-in-class.** Jules **writes a plan and blocks**; steps are expandable; chat to revise
and it regenerates. If you navigate away, **a timer auto-approves so tasks never deadlock**, and the
**Planning Critic** (2026-01-26) — a second agent critiquing the plan pre-execution — covers for the
absent human, with a claimed **9.5% reduction in task failures**. A separate Critic Agent reviews the
code. `requirePlanApproval` is a per-session API boolean.
**Isolation.** Full **Google Cloud VM** (Ubuntu, ~20GB, short-lived, destroyed per task), repo cloned in,
**environment snapshots** to skip setup. ⚠️ **No documented egress allowlist/proxy and no secret-lifecycle
docs** — a real gap versus Codex.
**Failure/retry.** Auto-retries transient step failures; repeated failure → `failed`; recover by **rerun**
from the summary, or edit the setup script/prompt and restart.
**Observability / cost.** Activity feed with per-step logs and a red-dot failure badge, diff / stacked
diffs, **audio changelogs** (narrated commit summaries), and **Memory** (learns per-repo preferences,
user-editable). **No cost surfacing at all** — flat task counts only.
**Pricing.** Free 15 tasks/24h · AI Pro $19.99 → 100/day · AI Ultra $249.99 → 300/day. Proprietary; only
`jules-action` and the Gemini CLI extension are open source.
**Worth stealing:** the **auto-approve timer + Planning Critic** pairing — the only design here that solves
unattended plan deadlock instead of ignoring it.

### D5. GitHub Copilot coding agent + Agent HQ
See §C5 for the API/data model. Agent HQ announced 2025-10-28; **Enterprise AI Controls + agent control
plane GA 2026-02-26**. Third-party agents from **Anthropic, OpenAI, Google, Cognition and xAI** ship
inside paid Copilot subscriptions. **Mission control** is real: a dashboard across github.com, VS Code,
mobile and Copilot CLI showing progress and letting you prompt agents that need input.
**Hard constraints: one repo, one branch, one PR per session; 59-minute maximum** (non-extendable).
**Isolation.** Ephemeral environment **on GitHub Actions** — standard Ubuntu runners, or larger/Windows/
self-hosted **ephemeral single-use** runners. Setup via `.github/workflows/copilot-setup-steps.yml` where
only `steps`, `permissions`, `runs-on`, `services`, `snapshot`, `timeout-minutes` are customizable.
**Integrated firewall** with a required-host allowlist; on self-hosted runners you must disable it and
bring your own; **incompatible with Windows**.
**Observability.** Session log viewer with real-time progress, **token consumption**, duration, internal
reasoning and tool use; **every commit links back to its session log** for audit. Cloud sessions are
**shared by default** with anyone who has repo access. Enterprise: `agent_session.task` audit events with
`actor_is_agent`, MCP allowlists, **custom agent definitions pushed from a canonical repo path via API**.
**HITL / failure.** Steer mid-run by typing a follow-up in the session prompt box (each steering message
costs credits). **Stop session** ends the Actions run but preserves commits. Agent-authored PRs can't
trigger workflows without human approval.
**Pricing.** Premium requests: Pro $10 → 300/mo, Pro+ $39 → 1,500/mo, **$0.04/request overage, no
rollover**. Key nuance: **only prompts you send count — the agent's own tool calls do not.** Copilot code
review carries a **13× model multiplier** from 2026-06-01. Proprietary.
**Worth stealing:** **commit → session-log backlinks.** Every artifact is one click from the reasoning
that produced it — the cheapest, highest-value observability feature in the entire survey.

### D6. Cursor (background/cloud agents, Cursor 3)
**Cursor 3 "Glass" shipped ~2026-04-02**: an **Agents Window** replaces Composer as the primary surface,
plus the **Composer 2** in-house model and Design Mode. Recent: **Builds** — pre-built environments,
cloud agents start **3× faster** (2026-08-13); **Origin** code hosting in early beta (2026-08-17 — Cursor
now competing with GitHub itself); Cursor for iPad with full PR review. ⚠️ "Cursor 3.5" in third-party
writeups is **[UNVERIFIED]**.
**Triggers.** Cursor Web, desktop dropdown, **@cursor in Slack / GitHub / Bitbucket PR comments /
Linear**, iOS/iPad, API.
**Parallelism / isolation.** Local agents run in **isolated git worktrees**, one per agent, each on its
own branch. Cloud agents run in **isolated VMs**. Env config three ways: agent-led setup, saved
snapshots, or a Dockerfile in `.cursor/environment.json`. Teams can **restrict outbound domains**, add
secrets, and **connect private networks via Tailscale**. **Local↔cloud handoff**: start local, push to
cloud to keep running, pull back to iterate.
**HITL.** No blocking plan gate; steer via follow-ups (team follow-ups are an admin toggle).
**Observability.** Agents produce **merge-ready PRs with artifacts to demo their changes — screenshots,
videos, logs**. Shareable agent URLs (viewers must prove repo access via connected SCM).
**Pricing.** Hobby free · Pro $20 · Pro+ · Ultra · Teams $40/user (Bugbot, shared cloud-agent context,
SSO) · Enterprise. **Cloud agents bill at API pricing by model and context-window size, with spend limits
set at setup.** Proprietary.
**Worth stealing:** requiring the agent to attach **demo artifacts** to its PR — evidence, not just a diff.

### D7. Amp (Sourcegraph)
~40k teams claimed by early 2026. **Amp Free (ad-supported) still exists**; subscriptions **$20 and
$200/mo** plus PAYG credits; **education tier $10/mo** (2026-08-18). Smart mode ran **Claude Opus 4.8** as
of 2026-06-04.
**Mechanics.** Threads (archivable, searchable, permalinked, shareable, visibility private/workspace/
group/unlisted, **multiplayer**). Four modes — `low/medium/high/ultra` — that each **pair an agent model
with an Oracle model** rather than selecting one; the **Oracle** is the deep-reasoning second opinion; the
**Librarian** subagent searches all public GitHub plus connected private repos without leaving the
thread. Subagents run isolated with no mid-task guidance. `AGENTS.md` with glob-scoped rules. CLI has
`-x` execute mode and streaming JSON.
**"Orbs" — the cloud story.** Remote execution units launched 2026-06-30; **user-chosen CPU/memory**;
**event-driven — orbs receive requests and react to outside events** (2026-07-23); OIDC workload identity;
shared/multiplayer control. Agents can **set their own schedules and wake themselves up** (2026-07-21) and
**spawn other agents, message them and exchange files** (2026-07-17). Slack via `@Amp`.
**Cost.** Unusually transparent token pass-through; Enterprise adds **per-user cost attribution**.
**Worth stealing:** modes as **agent+oracle pairs** — escalating reasoning is a property of the tier, not
a separate button the user must remember to press.

### D8. Ona (formerly Gitpod)
Rebranded from Gitpod (Sept 2025); "task in, pull request out," agents that run **in your VPC**.
**Major 2026 finding: Ona's own agent is being retired.** Docs state verbatim: *"Ona Agent is deprecated.
Use Codex Agent for all new environments and automations,"* and *"Ona Agent and Ona-managed Anthropic
model access are no longer available on Ona Cloud."* ⚠️ No EOL date published. Ona is repositioning as
**substrate for someone else's agent**.
**Triggers.** Chat, **Linear issues**, PR events, schedules, webhooks, manual runs. Native integrations:
Linear, Jira, Sentry, Notion, GitHub, GitLab.
**Isolation.** Cloud dev environments defined by `devcontainer.json` + `.ona/config.yaml`, with prebuilt
deps, running services, and real network/DB access. Guardrails: command allow/deny lists, scoped
credentials, **kernel-level policy enforcement**, RBAC, SSO, audit logs, VPC networking, environment
auto-delete. Automations fan out **across hundreds of repos** at once.
**Pricing.** Core **$20/mo** (80–2,200 **Ona Compute Units**/mo). Enterprise: **self-hosted VPC on AWS or
GCP**. Extra OCUs from **$10 per 40**. Published worked examples: 1 OCU = explain a small codebase *or*
one hour of a 4vCPU/16GB VM; 4 OCUs = create a new web app; 7 OCUs/hr for a 16vCPU/64GB GPU box.
**Worth stealing:** the **OCU rate card that fuses inference and infra into one published unit** with
concrete worked examples — the clearest cost communication anywhere in this survey.

### D9. Augment Code — pivoting, not dead
**Operational** (~$252M raised, ~156 employees) but dismantling its old product: **inline completions
removed from Indie/Standard/Legacy plans 2026-03-31**; users emailed in June 2026 that the **IDE
extensions are being sunset with ~1 month notice**. Pivoting to **"Intent," a multi-agent orchestration
product**. No acquisition found. ⚠️ **[UNVERIFIED]**: Intent's GA status, triggers, isolation,
observability and pricing. Its marketing also claims "Augment Cosmos" spanning ticket intake →
implementation → review → merge, and an Auggie CLI score of 51.80% on SWE-bench Pro (Feb 2026) — both
**[UNVERIFIED]**.

### D10. Sweep AI — pivoted out of the category
The 2023 GitHub-issue→PR bot **no longer exists as such**. sweep.dev is now *"the fastest coding assistant
for JetBrains"* — an IntelliJ plugin with a proprietary agent and a custom Tab autocomplete model, 4.9★ /
40k+ installs, SOC 2, zero data retention. `sweepai/sweep` on GitHub now reads "AI coding assistant for
JetBrains." No reference to the old GitHub agent remains. ⚠️ Current license/pricing **[UNVERIFIED]**.

### D11. Blitzy — the outlier bet
**$200M at $1.4B valuation (2026-05-05)**, led by Northzone with PSG, Battery, Jump, Morgan Creek. Not an
IDE copilot: it **reverse-engineers an existing enterprise codebase into a knowledge graph**, then an
orchestration layer runs **thousands of agents in parallel for days-to-weeks of uninterrupted
inference**, targeting **1M–100M+ LOC codebases** and multi-month human epics, orchestrating
Google/Anthropic/OpenAI models **100,000+ times per run** for quality.
⚠️ **blitzy.com and docs.blitzy.com both return 403 to fetches — everything here is from press releases.
The plan-approval UX, isolation model, PR output format, verification loop, observability and pricing are
all [UNVERIFIED].** Treat the scale claims as marketing until observed.

### D12. Tembo — fully pivoted, and structurally interesting
The Postgres platform company **became a control plane for other people's coding agents.** Tembo now runs
**Claude Code, Cursor Composer, Codex, OpenCode, Pi and Grok Build** across the same repos/tickets/tools,
**swappable via dropdown** with no migration. Triggers: Linear, Jira, Asana, Slack, Teams, GitHub, GitLab,
**Sentry, Datadog**, Notion, 150+ integrations, plus scheduled webhooks. Isolation: **isolated cloud VMs up
to 128GB RAM / 500GB disk**, deployable on AWS/GCP/Azure/on-prem. Output lands in a **PR review queue**
where humans approve or request changes before merge. **Every session, human- or agent-initiated, is
centrally logged**; SOC 2 Type II, ISO 27001, HIPAA/GDPR. Free tier · **Pro $60/mo · Max $200/mo**
(2026-01-29). Its Postgres DNA survives as an agent that watches slow queries and opens performance-fix
PRs. **Worth stealing:** harness-agnosticism as the product — *"run the right harness and model for each
job"* — which is exactly the position a personal factory should take toward Claude Code.

### D13. Codegen
Alive. Triggers: **`@codegen` in Slack**, assignment or mention in **Linear, Jira, ClickUp, Monday**,
GitHub comments, API. **Process-isolated sandboxes** with reproducible execution, plus **cost tracking and
performance analytics across agent runs**. Output: **GitHub PRs with change explanations linked back to
the originating request.** HITL: agents respond to PR review comments and answer questions in the original
thread. Notable: a **"Checks Auto-fixer"** monitors CI in real time, analyzes failures, and pushes targeted
fixes with **up to 3 retry attempts before escalating to a human** — the most explicit retry budget found
anywhere in this survey. SOC 2 Type I/II, on-prem option. ⚠️ Pricing, funding, and whether the
open-source graph-based `codegen` SDK is still maintained are **[UNVERIFIED]**; note also that its Linear
agent-directory page now 404s (§C2).
**Worth stealing:** a **named, bounded retry budget with explicit human escalation** — "3 attempts, then a
human" is a policy you can put in a config file.

### D14. Charlie Labs
Pivoted from "AI teammate" to **Daemons** — always-on, unprompted processes that keep work moving *after*
coding agents create it. The **V2 runtime** is explicitly *"durable, multi-step coding work across GitHub,
Linear and Slack… long-running execution that recovers from partial failures and follows through to
merge."* Triggers are hybrid event + scheduled: GitHub (PRs, merges, security advisories), Linear (issue
creation, label changes), Slack. Outputs: dependency/security-patch PRs, issue labels/assignment, doc
updates and link repair, root-cause-analysis comments. Safety via **deny rules** that bound each daemon
(e.g. explicitly cannot "merge pull requests" or "modify application logic"). Pricing is a **shared team
token budget** for background maintenance, so individual allocations go to novel work. ⚠️ Small company;
no 2026 funding news found.
**Worth stealing:** **deny rules as the daemon's definition** — a background role defined by what it may
*not* do is far easier to trust than one defined by what it should do.

### D15. Cross-cutting patterns in the commercial tier
1. **Plan-approval is bimodal.** Hard gates: **Factory Missions** (explicit sign-off → Mission Control),
   **Jules** (blocking plan + `requirePlanApproval` + auto-approve timer + Planning Critic), **Devin**
   (gate only when confidence is low). No gate at all: Codex cloud, Copilot coding agent, Cursor cloud
   agents, Codegen, Ona.
2. **Mid-run progress converges on three signals**: a streaming step log, a live diff, and a **backlink
   from artifact to reasoning** (Copilot's commit→session-log links, Devin's diff-line/message
   permalinks). Cursor alone demands **demo artifacts** — screenshots/video/logs — on the PR.
3. **Failure/retry is mostly unowned.** The real answers: Codegen's 3-attempt CI auto-fixer with human
   escalation, Jules's transient-step retry plus explicit rerun, Charlie's V2 "recovers from partial
   failures and follows through to merge," Devin's wake-sleeping-sessions-on-PR-comment. Codex has no
   retry orchestration; Copilot simply stops at 59 minutes.
4. **Cost surfacing splits three ways**: opaque flat counts (Jules tasks, Copilot premium requests),
   normalized composite units with published rate cards (Devin ACUs, Ona OCUs), and raw token/credit
   pass-through (Codex credits, Cursor API pricing, Amp). Best-in-class controls: **per-session hard caps
   with an acknowledgement modal** (Devin), **spend limits set at agent creation** (Cursor), **in-CLI live
   cost readout** (Codex `/status`), **per-user cost attribution** (Amp Enterprise).
5. **The isolation frontier moved from "which sandbox" to "whose network."** Devin Outposts
   (outbound-HTTPS worker in your VPC), Ona (customer VPC + kernel-level policy), Factory (laptop→CI→K8s→
   airgap with an autonomy ladder), Cursor (Tailscale + domain allowlists), Codex (two-phase network,
   secrets destroyed at the boundary), Tembo (VMs on your cloud). Copilot is the outlier, still bound to
   GitHub Actions runners.
6. **Harness-agnosticism became a business model in 2026.** Tembo sells "run any harness"; **Ona
   deprecated its own agent in favour of Codex Agent**; GitHub's Agent HQ hosts Anthropic/OpenAI/Google/
   Cognition/xAI agents. The differentiator migrated away from the agent loop and toward the environment,
   governance and cost plane around it — which is precisely the layer this project is building.

### D-LT. The long tail — verified status, 2026-08-18

- **OpenHands / All Hands AI — active; the strongest OSS ticket→PR loop in the survey.** GitHub org
  renamed to `OpenHands`; main repo **MIT, ~84k★**, pushed 2026-08-19; `software-agent-sdk` and
  `OpenHands-CLI` also MIT. **Loop: label an issue `openhands` *or* comment `@openhands` → the agent
  acks on the issue, works, and opens a PR with a summary comment.** GitLab and Bitbucket too.
  Isolation: **per-conversation Docker/K8s sandboxes**; `OpenHands-Cloud` Helm charts drive both the
  hosted app and self-host. $18.8M Series A (2025-11-18, Madrona) on top of $5M seed. OSS free;
  individual SaaS free (10 conversations/day, BYOK or at-cost tokens, no markup); enterprise custom
  (VPC, BYOK). CLI is "feature-complete, maintained for stability" — investment is in Cloud + SDK.
  https://openhands.dev · **Worth stealing:** label-or-mention as a dual trigger, and the
  conversation-scoped sandbox as the unit of isolation.
- **SWE-agent** — MIT, research OSS, superseded: the README now points at **mini-SWE-agent** (~100-line
  agent, bash-only, >74% SWE-bench Verified, "v2"). No hosted service, no PR pipeline. Not a factory,
  but mini-SWE-agent is a useful minimal-harness reference. https://swe-agent.com
- **Zencoder → "Zenflow"** — active. Zenflow Code, **Zenflow Work (2026-04-09)**, IDE agents. "Coffee
  Mode" (autonomous background work) still live; Repo Grokking is their multi-repo index. Claims
  Linear/Jira/GitHub intake plus scheduled and parallel agents — ⚠️ **trigger mechanics unverified**.
  Pro $45 / Pro Plus $95 / Pro Max $195 per user/mo (credit-per-call), BYOK unlimited. https://zencoder.ai
- **Qodo** — active but **repositioned to code review + governance, not generation**. `qodo-ai/pr-agent`
  is **MIT and donated to the community**; it reviews and describes PRs, it does not create them.
  ⚠️ Qodo Gen, Qodo Command/CLI and Qodo Aware no longer appear on qodo.ai or docs.qodo.ai — apparently
  folded or retired with no discontinuation notice. Pro Team $30/mo → enterprise. https://qodo.ai
- **Tabnine — ACQUIRED by Tricentis, announced 2026-07-30.** Now positioned as an Enterprise Context
  Engine + SDLC agents (SaaS / on-prem / air-gapped). No verified async ticket→PR product.
- **Refact.ai — winding down.** `smallcloudai/refact` **archived 2026-05-30** (BSD-3-Clause; development
  redirected to a personal fork); **"Refact Cloud is shutting down soon" posted 2026-04-30**, banner
  still live. All SWE-bench claims are 2025-era. ⚠️ Company fate unverified.
- **Trae (ByteDance)** — active; **SOLO absorbed, not killed**: trae.ai is now **TraeWork** (Work/Code/
  Design modes) + **TraeCode**, and `docs.trae.ai/solo/...` renders as "What is TraeWork?" Available
  internationally; ⚠️ no public enterprise tier as of a Jun 2026 review; the ~$10/mo Pro figure is
  third-party-sourced. IDE/desktop-centric, **no verified async loop**.
- **Windsurf — brand retired into Devin Desktop.** Confirmed via Cognition's blog: the OpenAI deal
  collapsed → Google reverse-acquihire of Mohan/Chen (~$2.4B, 2025-07-11) → **Cognition acquired the
  remainder (2025-07-14)**. Then SWE-1.5 (Oct 2025) → Codemaps (Nov 2025) → "Devin in Windsurf"
  (2026-04-15) → **"Introducing Devin Desktop" (2026-06-02), "the next generation of Windsurf,"
  backwards-compatible** → SWE-1.7 (2026-07-08). **windsurf.com now 308-redirects to
  devin.ai/desktop.** No software EOL; the brand is gone.
- **Warp — pivoted squarely into this category, one day before this survey.** **Warp Factories launched
  2026-08-18**: cloud software-factory infrastructure orchestrating agent fleets across the SDLC,
  **defined as code**, harness- and model-agnostic, with human checkpoints. Also **Warp Agent CLI
  (2026-08-04)** and Warp Code v2 (agent "Oz," multi-repo changes, **computer-use verification**,
  Linear/Figma/Slack MCP). **The Warp Terminal client is now open source, dual MIT (warpui) /
  AGPLv3.** Free · Build $20 (1,500 credits) · Max $200 (18,000) · Business $50/user · enterprise
  self-hosted; **Factories add-on is PAYG at a 20% markup, or subscription with up to $10k
  early-access credits.** ⚠️ Ticket-source trigger mechanics unverified. https://warp.dev
  **Worth stealing:** "factory defined as code, harness-agnostic, with explicit human checkpoints" is
  the closest commercial statement of your thesis — and computer-use verification as a gate is novel.
- **Solver / Laredo Labs — ACQUIRED BY NVIDIA (~2025-09-02); dead as a product.** laredolabs.com and
  solver.sh both 404. Had raised ~$8M (Radical Ventures, Horizons). ⚠️ Evidence is trade press, not a
  primary NVIDIA post.
- **Poolside** — a model lab, **no ticket→PR product**, with capital/infrastructure trouble. Ships the
  **Laguna** line (XS 2.1 2026-07-02; **S 2.1: 118B total / 8B active, 1M context, 2026-07-21**) via
  OpenRouter/Vercel; "Poolside Platform" (2026-05-05, agents inside your boundary), Dell partnership,
  macOS desktop assistant (2026-07-28); acquired Fern Labs (Nov 2025). ⚠️ No "malibu" model exists —
  likely a stale codename. ~$2B round Oct 2025 at ~$12B including up to $1B from NVIDIA; **Project
  Horizon** (2GW, Fort Stockton TX): **CoreWeave withdrew May 2026**, scaled down to 400MW with no
  anchor tenant as of Jul 30; **a $2B Series C at $14B collapsed Apr 2026.** Medium confidence.
- **Magic.dev — alive but silent.** Site up, $515M raised, ~10 open SF roles, LTM-2-mini / 100M-token
  context still the headline. **No shipped product and no dated 2025–2026 announcement found**; no
  acquisition or layoffs (layoff hits refer to Magic Leap). ⚠️ "Alive" here means only that the site
  and job board are current.

### D-X. Three findings that matter more than any individual vendor

**1. Four hard exits in twelve months inside this cluster** — Solver→NVIDIA (Sep 2025), Windsurf brand
→Devin Desktop (Jun–Jul 2026), Tabnine→Tricentis (2026-07-30), Refact.ai archived + cloud shutdown
(Apr–May 2026) — plus soft exits: **Sweep** pivoted to a JetBrains plugin, **Augment** is sunsetting its
IDE extensions and pivoting to "Intent," **Ona deprecated its own agent in favour of Codex**, and
**Qodo dropped generation for review/governance**. Combined with §A10 (Vibe Kanban sunsetting, Crystal
deprecated, Terragon shut down, Height dead, HumanLayer deprecated), the category-level lesson is
stark: **build on primitives you control (git, SQLite, a CLI you invoke as a subprocess), not on a
vendor's orchestration layer.**

**2. Several famous names are not actually in this category**, despite reputation: Qodo, Tabnine, Trae,
SWE-agent, Poolside, Magic.dev. The verified async ticket→PR loops in the long tail are **OpenHands**,
**Warp Factories** (one day old), and **Zencoder** (claimed but unverified).

**3. "Software factory" is now a contested product term.** Factory.ai's own "Software Factory" docs
section, **Warp Factories** (2026-08-18), and Devin's "Agent Command Center" all describe the same
thing: a governed control plane that intakes tickets, fans out to sandboxed agents, and lands
reviewable PRs. The term you're using for a personal project is, as of this month, also an enterprise
category name.
---

---

## Section E — Anthropic's own surface area (what you'd build the factory on)

Docs moved in 2026: Claude Code docs are now at `code.claude.com/docs/en/*`; Agent SDK at
`code.claude.com/docs/en/agent-sdk/*`.

### E1. Agent Teams — ✅ real, experimental, **and not usable headlessly**
https://code.claude.com/docs/en/agent-teams — disabled by default:
`{"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}}`

One session is the **team lead**; teammates are *full independent Claude Code sessions* (not
subagents) with their own context windows. Claude spawns one by calling the Agent tool **with a
`name`** — no confirmation prompt. Coordination artifacts on disk:
- `~/.claude/teams/{team-name}/config.json` (`members` array; lead's agent type is `team-lead`)
- `~/.claude/teams/{team-name}/inboxes/{agent-name}.json` — a **mailbox per agent**
- `~/.claude/tasks/{team-name}/` — **shared task list**, persists across resume, claimed via file
  locking, tasks have pending/in-progress/completed + dependencies
- `{team-name}` = `session-` + first 8 chars of session ID. One team per session, no nesting, fixed lead.

Teammate definitions reuse `.claude/agents/*.md` subagent types; the definition's `tools` allowlist and
`model` are honoured and its **body is appended** to the teammate's system prompt (not replacing it).
`skills` and `mcpServers` frontmatter are **not** applied to teammates.
UI: agent panel below the prompt, Enter opens a teammate's transcript and messages it directly, Esc
interrupts, `x` stops, Ctrl+T toggles the task list; `{"teammateMode":"auto"}` gives tmux/iTerm2 split panes.
Hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit code 2 = block + feedback).

> **Critical for a factory: Agent Teams do not work in non-interactive mode (`-p`) or via the Agent
> SDK** — a named subagent there runs as an ordinary subagent. Also, with teams on, the idle
> notification reports only *that* a teammate stopped, **not its output**, so flows that wait on
> results can stall.

### E2. Claude Code on the web / cloud sessions
https://code.claude.com/docs/en/claude-code-on-the-web (research preview, Pro/Max/Team/Enterprise)
- Each session runs in an **isolated Anthropic-managed VM**; git credentials and signing keys are
  **never inside the sandbox** — auth goes through a proxy with scoped credentials.
- **Cloud environments** (`/docs/en/cloud-environments`) control network access (Trusted allowlist /
  Custom / Full), env vars, and a cached setup script.
- Terminal → web: `claude --cloud "task"` clones your GitHub *remote* at your current branch (not your
  local checkout). Parallelism = issue multiple `--cloud` commands. Non-GitHub repos fall back to a
  local bundle (`CCR_FORCE_BUNDLE=1`, <100 MB, tracked files only, can't push back).
- Follow-ups: `claude -p "msg" --cloud <session-id>` queues and exits; `--output-format json` returns
  `{ok, session_id, url}`.
- Web → terminal: `claude --teleport [<session-id>]`, `/teleport`/`/tp`, or `t` in `/tasks`. Requires
  clean git state, same repo, pushed branch, same account. Teleport hands the terminal *its own copy* —
  later work does **not** flow back.
- Session → PR: diff view with `+42 -18` indicators and inline comments; PR created from the web UI.
  **Auto-fix PRs** subscribes to GitHub webhooks and pushes fixes for CI failures / review comments
  (`/autofix-pr`; requires the Claude GitHub App). Caveat: replies post under *your* GitHub account,
  which can trigger `issue_comment` automation loops.

### E3. Routines (`/schedule`) — cloud cron agents
https://code.claude.com/docs/en/routines (research preview). A routine = saved prompt + repos + cloud
environment + connectors, with **schedule** (min interval **1 hour**), **API**, or **GitHub event** triggers.

```bash
curl -X POST https://api.anthropic.com/v1/claude_code/routines/trig_01ABC.../fire \
  -H "Authorization: Bearer sk-ant-oat01-xxxxx" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -d '{"text": "Sentry alert SEN-4521 fired in prod."}'
# -> {"type":"routine_fire","claude_code_session_id":"session_01...","claude_code_session_url":"..."}
```

**Security design worth copying:** `text` arrives wrapped in a `<routine-fire-payload>` block
**explicitly labeled untrusted** — the saved prompt must opt in to acting on it. GitHub triggers
support `pull_request.*` and `release.*` with filters (author/title/body/base/head/labels/is-draft/
is-merged, regex operators). Runs are fully autonomous — **no permission prompts** — and Claude pushes
to `claude/`-prefixed branches. Daily per-account run cap; requires subscription login (not API key,
not Bedrock/Vertex).

### E4. Claude Agent SDK — the actual build surface
https://code.claude.com/docs/en/agent-sdk/overview — Python + TypeScript only; other languages should
drive the CLI as a subprocess with `-p --output-format stream-json`.

```typescript
function query({ prompt, options }: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

Options that matter for a factory: `agents` (programmatic `AgentDefinition{description, prompt, tools,
model}`), `hooks`, `canUseTool`, `permissionMode`, `mcpServers`, `plugins`, `skills`, `settingSources`,
`resume` / `forkSession` / `resumeSessionAt` / `sessionId` / `sessionStore`, `includePartialMessages`,
`includeHookEvents`, `forwardSubagentText`, `agentProgressSummaries`,
`outputFormat: {type:'json_schema', schema}`, `maxTurns`, `maxBudgetUsd`, `effort`,
`enableFileCheckpointing`, `sandbox`, `systemPrompt: {type:'preset', preset:'claude_code', append}`.

**Message stream** (`SDKMessage` union) — the load-bearing members:
- `SDKSystemMessage` — `{type:"system", subtype:"init", session_id, cwd, tools, mcp_servers, model,
  permissionMode, slash_commands, skills, plugins, agents?, claude_code_version, capabilities?}`
- `SDKAssistantMessage` / `SDKUserMessage` — carry **`parent_tool_use_id`** for subagent attribution
- `SDKPartialAssistantMessage` — `{type:"stream_event", event, parent_tool_use_id: null, ttft_ms?}`
  (only with `includePartialMessages`; **main session only**)
- `SDKCompactBoundaryMessage` — `{type:"system", subtype:"compact_boundary",
  compact_metadata:{trigger:"manual"|"auto", pre_tokens}}`
- Observability-grade: `SDKHookStartedMessage`, `SDKHookProgressMessage`, `SDKHookResponseMessage`,
  `SDKToolProgressMessage`, `SDKToolUseSummaryMessage`, `SDKTaskStartedMessage`/`Progress`/`Updated`,
  `SDKPermissionDeniedMessage`, `SDKRateLimitEvent`, `SDKMemoryRecallMessage`, `SDKThinkingTokensMessage`

**Result message — the per-phase cost record you want to persist:**
```typescript
{ type:"result"; subtype:"success"; session_id; duration_ms; duration_api_ms;
  is_error; num_turns; result: string; stop_reason; ttft_ms?; ttft_stream_ms?;
  total_cost_usd; usage: NonNullableUsage;
  modelUsage: { [modelName: string]: ModelUsage };
  permission_denials: SDKPermissionDenial[];
  structured_output?; terminal_reason?; ... }
```
Error subtypes: `error_max_turns | error_during_execution | error_max_budget_usd |
error_max_structured_output_retries`.
⚠️ **`usage` excludes subagents — use `modelUsage` for whole-tree accounting.** `total_cost_usd` is an
explicitly labeled *client-side estimate*. `terminal_reason` is a ready-made phase-exit taxonomy
(`completed`, `max_turns`, `hook_stopped`, `budget_exhausted`, `api_error`, …).

**Hook events (verbatim):**
```
PreToolUse | PostToolUse | PostToolUseFailure | PostToolBatch | Notification | UserPromptSubmit |
UserPromptExpansion | SessionStart | SessionEnd | Stop | StopFailure | SubagentStart | SubagentStop |
PreCompact | PostCompact | PermissionRequest | PermissionDenied | Setup | TeammateIdle | TaskCreated |
TaskCompleted | Elicitation | ElicitationResult | ConfigChange | DirectoryAdded | WorktreeCreate |
WorktreeRemove | InstructionsLoaded | CwdChanged | FileChanged | MessageDisplay
```
Hook stdin carries `session_id, prompt_id, transcript_path, cwd, permission_mode, hook_event_name,
effort, agent_id, agent_type`; output `{continue, stopReason, suppressOutput, systemMessage,
hookSpecificOutput:{hookEventName, permissionDecision:"allow"|"deny"|"defer", additionalContext,
updatedInput, decision, reason}}`; exit 2 = blocking. Handler `type` can be
`command | http | mcp_tool | prompt | agent`.

Permission modes: `default | acceptEdits | bypassPermissions | plan | dontAsk | auto`. Note
`canUseTool` fires **only when evaluation resolves to a prompt** — to gate *every* call, use a
`PreToolUse` hook.

### E5. OpenTelemetry from Claude Code — **the single biggest free win**
https://code.claude.com/docs/en/monitoring-usage — `CLAUDE_CODE_ENABLE_TELEMETRY=1` plus
`OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` / `OTEL_TRACES_EXPORTER` (traces = beta).
- Metrics: `claude_code.session.count`, `.lines_of_code.count`, `.pull_request.count`, `.commit.count`,
  `.cost.usage` (USD), `.token.usage`, `.code_edit_tool.decision`, `.active_time.total`.
- **Cost/token attributes include `model`, `query_source` (`main|subagent|auxiliary`), `agent.name`,
  `skill.name`, `plugin.name`, `mcp_server.name` — per-phase cost attribution is already emitted.**
- Log events: `claude_code.user_prompt`, `.assistant_response`, `.tool_result`, `.api_request` (with
  `cost_usd`, `input_tokens`, `cache_read_tokens`, `request_id`), `.api_error`, `.api_refusal`,
  **`.api_request_body` / `.api_response_body` — the fully compiled prompt**, gated behind
  `OTEL_LOG_RAW_API_BODIES=1` (or `file:<dir>`), `.tool_decision`, `.permission_mode_changed`,
  `.mcp_server_connection`.
- Content gates: `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_ASSISTANT_RESPONSES=1`, `OTEL_LOG_TOOL_DETAILS=1`,
  `OTEL_LOG_TOOL_CONTENT=1`, `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`.
- **Beta spans** (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`): `claude_code.interaction` → `.llm_request` /
  `.hook` / `.tool` → `.tool.blocked_on_user` / `.tool.execution`, with `agent_id`, `parent_agent_id`,
  `workflow.run_id`, `ttft_ms`, `stop_reason`. **This is a ready-made swim-lane tree.**

### E6. The building blocks, concretely
- **Subagents** — `.claude/agents/*.md`. Frontmatter: `name`, `description` (required); optional
  `tools`, `disallowedTools`, `model` (`sonnet|opus|haiku|fable|inherit`), `permissionMode`, `maxTurns`,
  `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, **`isolation: worktree`**, `color`,
  `initialPrompt`. (`isolation: worktree` is a big deal — per-subagent worktrees for free.)
- **Skills** — `.claude/skills/<name>/SKILL.md`. **Custom commands merged into skills**:
  `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`. Frontmatter:
  `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`,
  `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, **`context: fork`** +
  `agent` + `background`, `hooks`, `paths`, `shell`, `metadata`. Substitutions: `$ARGUMENTS`, `$0`,
  `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`,
  `${CLAUDE_PLUGIN_ROOT}`. Follows the agentskills.io open standard.
- **Plugins/marketplaces** — plugin root: `.claude-plugin/plugin.json` + `skills/`, `agents/`,
  `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `monitors/monitors.json`, `bin/`, `settings.json`,
  **`workflows/`**. Test with `claude --plugin-dir ./p`. **This is how you'd ship your factory** — the
  same "stamp a skill into any repo" move SSSF makes.
- **Memory** — precedence: managed policy → `~/.claude/CLAUDE.md` → `./CLAUDE.md` or
  `./.claude/CLAUDE.md` → `./CLAUDE.local.md`; `@path` imports (4 hops); **`.claude/rules/*.md` with
  `paths:` glob frontmatter for lazy path-scoped rules**; `claudeMdExcludes`. **Auto memory** writes
  `~/.claude/projects/<project>/memory/MEMORY.md` (first 200 lines / 25KB loaded per session).
- **Checkpoints/rewind** — snapshot before each user prompt, 100 most recent, 30-day retention;
  `/rewind` or Esc-Esc. **Does not track Bash-made changes, subagent edits, or symlinked paths.** Not a
  git replacement — you still want branch-per-run.
- **Background** — subagent `background: true`, Bash `run_in_background`, `/tasks`, task panel.

### E7. Dynamic Workflows — **the most factory-relevant primitive Anthropic ships**
https://code.claude.com/docs/en/workflows (v2.1.154+). Claude writes a JavaScript orchestration script
that the runtime executes **out of context**:

```javascript
export const meta = { name: 'audit-routes', description: '...' }
const found  = await agent('List every .ts file under src/routes/.', { schema: {...} })
const audits = await pipeline(found.files, file => agent(`Audit ${file}...`, { label: file }))
return audits.filter(Boolean)
```

`agent()` spawns one subagent, `pipeline()` one per item; top-level `await`; **no imports, no filesystem
or shell from the script itself**; ≤16 concurrent agents, **1,000 agents/run**; resumable within the
session (replay stops at the first unfinished agent — so *many small agents preserve more progress*).
**`/workflows` TUI shows per-phase agent counts, token totals, elapsed time, and drills into each
agent's prompt, tool calls, and result** — i.e. Anthropic shipped a mini version of the swim-lane view.
Save with `s` into `.claude/workflows/` or `~/.claude/workflows/` → becomes `/<name>`. Trigger with the
`ultracode` keyword or `/effort ultracode`. Workflow subagents always run `acceptEdits`.

**This is the closest thing to SSSF's ADW scripts that ships in the box** — and its limitation
(session-scoped, no durable store) is exactly the gap your factory fills.

### E8. Anthropic engineering posts worth reading
- **"How we built our multi-agent research system"** —
  https://www.anthropic.com/engineering/multi-agent-research-system — orchestrator-worker; the
  LeadResearcher **saves its plan to Memory to survive 200k-context truncation**; a separate
  **CitationAgent** attributes claims at the end. Numbers: *"Agents typically use about 4× more tokens
  than chat interactions, and multi-agent systems use about 15× more tokens than chats."* Three factors
  explained **95%** of performance variance — **token usage alone 80%** — plus tool-call count and model
  choice. Multi-agent (Opus 4 lead + Sonnet 4 subagents) beat single-agent Opus 4 by **90.2%**.
  Delegation prompt principle: give each subagent an **objective, output format, tool/source guidance,
  and task boundaries**. Scale effort to complexity (1 agent / 3–10 calls for fact-finding). Let Claude
  self-improve its prompts (a tool-tester agent cut task time 40%). Evals: start with **~20 queries**,
  LLM-as-judge in a *single call* scoring 0.0–1.0 on factual accuracy, citation accuracy, completeness,
  source quality, tool efficiency. Production lessons: full production tracing; rainbow deployments;
  **durable/resumable execution instead of restart-from-scratch**; *"minor changes cascade into large
  behavioral changes."* Lead agents execute subagents **synchronously** — an acknowledged bottleneck.
- **Building effective agents** (Dec 2024) — the five workflow patterns (prompt chaining, routing,
  parallelization, orchestrator-workers, evaluator-optimizer) vs. autonomous agents.
  https://www.anthropic.com/engineering/building-effective-agents **[lower confidence — not re-fetched]**
- **Effective context engineering for AI agents** — context rot, system-prompt "altitude", just-in-time
  retrieval via lightweight identifiers, compaction, structured note-taking as external memory,
  subagents for context isolation returning condensed summaries.
- **Writing effective tools for agents** — eval-driven iteration, namespacing (`asana_search`), return
  only high-signal context; Claude Code caps tool responses at **25,000 tokens**.
- **Code execution with MCP** — expose MCP servers as a filesystem of code APIs read on demand:
  *"reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%."*
- **Building a C compiler with a team of parallel Claudes** (2026-02-05) — 16 Opus 4.6 agents in Docker
  containers against a shared bare git repo, lock files in `current_tasks/`, an infinite bash loop.
  ~2,000 sessions over two weeks, **2B input / 140M output tokens, just under $20,000**, producing a
  100k-line Rust C compiler that builds Linux 6.9. Core lesson: *"the task verifier is nearly perfect,
  otherwise Claude will solve the wrong problem."* Tests must be concise (context), subsamplable (time
  blindness), grep-friendly; use an oracle (GCC) for differential testing.
- **A harness for every task: dynamic workflows in Claude Code** (2026-06-02) — the design doc behind
  Workflows; six patterns: classify-and-act, fan-out-and-synthesize, **adversarial verification**,
  generate-and-filter, tournament, loop-until-done. Targets three single-context failure modes:
  **agentic laziness, self-preferential bias, goal drift.**
- **Claude Code best practices** — https://code.claude.com/docs/en/best-practices — throughline: *give
  Claude a check it can run*, escalating in-prompt → `/goal` condition → **Stop hook as a deterministic
  gate** (Claude Code overrides after 8 consecutive blocks) → adversarial reviewer subagent.
  Explore→plan→code→commit; `/clear` after two failed corrections; Writer/Reviewer across two sessions.
- **How Anthropic teams use Claude Code** — https://claude.com/blog/how-anthropic-teams-use-claude-code

### E9. What Anthropic gives you free vs. what you must build

**Free:**
- The agent loop, context management, compaction, tools, permission engine (SDK, both languages).
- **Complete per-event observability**: OTel metrics + logs + beta spans with
  `agent_id`/`parent_agent_id`/`workflow.run_id` attribution, `cost_usd` per API request, and **the raw
  compiled request/response bodies** via `OTEL_LOG_RAW_API_BODIES`. Plus ~31 hook events and an SDK
  message stream with hook-started/progress/response and tool-progress events.
- Per-call cost/usage in `SDKResultMessage.modelUsage` (whole-tree, per-model, cache split) and
  `permission_denials`.
- Phase primitives: subagents (isolated context, `isolation: worktree`), skills (progressive
  disclosure), workflows (`agent()`/`pipeline()`, resumable, per-phase TUI with token totals).
- Ticket→PR plumbing: routines with GitHub/API/cron triggers, cloud sandboxes, auto-fix PRs,
  `--cloud` / `--teleport`.

**You must build:**
- **The durable store.** Nothing persists a cross-session, cross-phase run record. OTel is
  fire-and-forget to *your* collector; workflow resume dies when the CLI exits; agent-team task lists
  are local-only. You need a run/phase/agent/tool_call schema keyed on `session_id` + `agent_id` +
  `workflow.run_id`.
- **The swim-lane UI.** `/workflows` is a terminal view of one run. No persistent multi-run dashboard,
  no per-phase diff/prompt/cost browser, no historical comparison.
- **Prompt lineage.** Raw bodies are logged, but nothing links "compiled prompt" → the
  CLAUDE.md/rule/skill/subagent frontmatter that produced it. Instrument `InstructionsLoaded` +
  `UserPromptExpansion` + `api_request_body` yourself.
- **Ticket ingestion and the state machine.** Routines' payload is deliberately inert; Linear/Jira →
  phase graph → gate → PR is yours.
- **Authoritative cost.** `total_cost_usd` is a client-side estimate; reconcile against the Usage & Cost API.
- **Deterministic gates** — the hook points exist; the verifiers (build, tests, oracle diffs, rubric
  judges) are the actual product.
- **Cross-surface orchestration.** Agent Teams are interactive-only; Workflows are session-scoped;
  Routines are cloud-only and account-scoped. A factory spanning all three needs your own supervisor
  process driving the SDK.

---

## Section F — Concepts, essays, and the discourse (Aug 2025 – Aug 2026)

### F1. "Harness engineering" — the most useful frame published this year
**[VERIFIED]** Birgitta Böckeler (Thoughtworks), martinfowler.com, 2026-04-02.
https://martinfowler.com/articles/harness-engineering.html

Central equation: **Agent = Model + Harness.** Three concentric layers: the model core, the *inner
harness* built by the agent framework (system prompts, retrieval, orchestration), and the *outer
harness* you build for your codebase. The harness works through two mechanisms:
- **Guides** (feedforward) — anticipate problems, steer before acting, raise first-attempt success.
- **Sensors** (feedback) — observe outputs, enable self-correction; best when optimized for LLM reading.

Each exists in two modes: **computational** (deterministic — linters, tests, type checkers,
milliseconds) and **inferential** (semantic, slower, richer). Three regulation categories:
maintainability harness (most mature), architecture fitness harness, behaviour harness (least mature).

> "A good harness should not necessarily aim to fully eliminate human input, but to direct it to where
> our input is most important."

Companion pieces: *Maintainability sensors for coding agents* (2026-05-27,
https://martinfowler.com/articles/sensors-for-coding-agents.html), *Context Engineering for Coding
Agents* (2026-02-05,
https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html), and the
running *Exploring Gen AI* series (https://martinfowler.com/articles/exploring-gen-ai.html).

**Why it matters for us:** "guides vs sensors × computational vs inferential" is a 2×3 grid you can
literally use to classify every gate, hook, and reviewer lens in the factory — and it tells you which
ones should be *code* phases rather than agent phases (exactly SSSF's argument, arrived at
independently).

### F2. Ralph Wiggum technique — Geoffrey Huntley
**[VERIFIED]** https://ghuntley.com/ralph/ · repo: https://github.com/ghuntley/how-to-ralph-wiggum ·
curated list: https://github.com/snwfdhmp/awesome-ralph

The loop, in full:
```bash
while :; do cat PROMPT.md | claude-code ; done
```
Single process, no multi-agent messaging. Each iteration does one discrete task and picks the
highest-priority item itself. The technique is really about **deterministic stack allocation**: every
loop re-reads the same files in the same order — `@fix_plan.md` (prioritized TODO, rewritten each
iteration), `@specs/`, `@AGENT.md` (build/run instructions the agent self-improves), `PROMPT.md`.

Two modes, deliberately separated: **PLANNING** does gap analysis (specs vs code) using parallel
subagents and emits a prioritized plan — *no implementation, no commits*; **BUILDING** picks ~10 items,
implements, runs tests, commits.

**"Backpressure"** = the mechanical rejection surface: compiler errors, test failures, type checkers,
custom security scanners. Principle: *the wheel has got to turn fast* — trade correctness strength
against iteration speed.

Documented failure modes: false negatives on grep ("assume not implemented" → mandate a parallel
subagent search first); placeholder/stub implementations (LLM chasing "it compiles" as the reward);
context-window exhaustion (delegate expensive reads to subagents); irrecoverably broken trees
(`git reset --hard`). Huntley is explicit that senior engineer guidance is required and calls
zero-oversight claims "peddling horseshit." Works best greenfield, to ~90% completion.

**Worth stealing:** the *planning-mode/building-mode split as separate prompt files*, the
self-improving `AGENT.md`, and "backpressure" as the name for your gate layer.

### F3. The critical literature — read this before designing autonomy
**[VERIFIED]**
- **METR RCT**: experienced OSS developers were **19% slower** with early-2025 AI tools while
  estimating they were 20% *faster* — a 39-point perception gap.
  https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- **METR changed the experiment design (2026-02-24)**: they now believe developers are likely more
  sped up in early 2026, but the new data was hard to interpret — partly because *time-per-task is
  unreliable for developers running multiple agents concurrently*.
  https://metr.org/blog/2026-02-24-uplift-update/ — i.e. **the concurrency you're designing for breaks
  the measurement**, which is itself an argument for building cost/latency instrumentation in.
- **The review/validation bottleneck**: merged PRs site-wide grew from ~25M/month (Jan 2023) to
  ~90M/month (Mar 2026). Jazzband (Python collective) shut down citing AI spam; curl ended its bug
  bounty; Godot maintainers describe triage as demoralizing. GitHub added PR caps for maintainers.
  https://thenewstack.io/ai-generated-code-crisis/ ·
  https://www.signadot.com/blog/ai-generated-code-crisis/ ·
  https://www.coderabbit.ai/blog/github-gives-maintainers-a-throttle-for-the-ai-pull-request
- **The throughput mismatch, stated plainly**: "if a developer generates six PRs a day and each needs
  30+ minutes of manual validation, they spend most of their time managing a deployment queue rather
  than building software."
- **Practical ceiling on parallelism**: multiple 2026 practitioner guides converge on **4–8 concurrent
  worktrees per developer**, above which you are bottlenecked on *review*, not on the model.
  https://superset.sh/blog/parallel-coding-agents-guide ·
  https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide
- **"Stop reviewing agent code, start verifying it"** — the emerging counter-position: trust comes from
  automated proof (TDD, runtime checks, conformance suites, blast-radius sandboxes), not from reading
  more diffs. https://www.brgr.one/blog/stop-reviewing-agent-code-start-verifying · Simon Willison,
  *Engineering practices that make coding agents work* (Pragmatic Summit talk),
  https://www.youtube.com/watch?v=owmJyKVu5f8 · https://simonw.substack.com/p/agentic-engineering-patterns

**Design consequence:** for a *personal* factory, throughput is not your constraint — your own review
attention is. Optimize the design for **making review cheap and evidence-rich**, not for spawning more
agents.

### F4. Spec-driven development as a movement (and its critics)
**[PARTIAL]** — the movement is clearly real; individual vendor claims below are secondhand.
- Founding talk: Sean Grove, "The New Code," AI Engineer World's Fair 2025 — specs as the durable
  artifact, code as a lossy projection.
- Flagship tooling: GitHub **Spec Kit** and AWS **Kiro**; radical wing: **Tessl** (spec-as-source);
  a "sober taxonomy" separating levels of ambition from Thoughtworks.
- Recurring critique: the real 2026 failure is **drift** — "confident, plausible code that quietly
  solves the wrong problem because nobody grounded the work in a real specification"; and weak specs
  push review too late to prevent wrong-direction work.
- Instruction-budget critique, widely repeated: frontier models reliably follow on the order of
  **150–200 standing instructions** before compliance degrades — so an auto-generated,
  everything-included `AGENTS.md` is "a failure mode wearing a diligence costume." **[UNVERIFIED
  number]** — treat as a heuristic, not a measurement.
- Emerging pattern worth noting: a **Critique persona that reviews the spec before implementation
  starts**, distinct from a Verify persona that catches implementation drift afterwards. Direction
  errors are cheapest to catch pre-code.
- Overviews: https://www.devoteam.com/expert-view/spec-driven-development-2026/ ·
  https://www.pluralsight.com/resources/blog/software-development/spec-driven-development-with-AI-SDD

### F5. Practitioner case study: 1Password's ticket→PR pipeline
**[VERIFIED]** 2026-05-19, https://1password.com/blog/agent-driven-design-system

The single most transferable production case study found:
- **Trigger = a ticket label.** "A developer reviews the ticket, decides it's well-scoped, applies a
  label, and the pipeline fires." Human qualification stays in the loop; everything downstream is
  automated. This is the cheapest possible HITL gate and it sits at exactly the right place.
- Stages: ticket intake (Jira) → context gathering (Figma + component library) → implementation →
  test/validate → PR with documentation.
- **Knowledge encoded as eight narrow skills** (scaffold component, define tokens, write Storybook
  stories, add icons cross-platform, open MR, debug CI failures, trace cross-platform token impacts)
  rather than general reasoning — plus an MCP server ("Knox") serving authoritative design-system
  guidance.
- **Uncertainty flagging in the PR body** as a first-class output: "*I wasn't sure whether this token
  belongs at the alias or component tier; I chose alias, but please verify*" is more useful than
  confident-and-wrong.
- **Metric chosen deliberately**: not velocity, but *what percentage of agent PRs need only review and
  minor tweaks versus a substantial rewrite.*

**Worth stealing:** label-as-trigger, uncertainty-as-output-field, and the rewrite-rate metric.

### F6. Other framing sources
- **Xebia, "Shining some light in dark agentic software factories"** (Noah Blauensteiner,
  2026-08-12) — https://xebia.com/articles/shining-some-light-in-dark-agentic-software-factories/
  Assembly-line framing: planning agents → implementation agents → reviewing agents, with hybrid
  stations for deterministic code and human review. Advice: set token budgets, watch factory-level
  dashboards (performance/quality/cost) rather than individual outputs, start on trivial tagged issues
  to build trust, and match model sophistication to ticket complexity (bugs need less reasoning than
  features). Mentions two OSS factories: **Sandcastle** and **GasCity** **[UNVERIFIED]**.
- **BCG Platinion, "The Agentic Software Factory"** —
  https://www.bcgplatinion.com/insights/the-agentic-software-factory (consultancy framing; low
  technical density).
- **Agent-native tracker requirements**, a decent checklist seen repeated across 2026 writing:
  machine-readable specs, a gate before work starts, one branch per issue, and status linked to the
  actual diff. https://aidenapp.org/issue-tracking-for-ai-agents
- **Hiveship** **[VERIFIED, commercial]** — https://hiveship.app/ — "agent-native issue tracker where
  coding agents are first-class assignees, with their own identity, sessions, and a full audit trail."
  Supports Claude Code, Cursor, OpenAI Codex (Copilot/Devin on roadmap). Drag-and-drop assignment to
  human *or* agent; workflow adapts to assignee type. Agent runs create **sessions streamed over SSE**
  (status changes, tool calls, progress). Statuses shown: `Backlog_queue` → `In_execution` →
  `Deployed_stable`, with completed work landing in a **review queue** with full activity log + PR
  diff. TypeScript SDK, MCP server, webhooks, GitHub PR linking. Proprietary; $0/$19/$59/mo tiers.
  *This is the closest commercial analogue to what you're building — worth a free-tier account to
  study its object model.*
- **Human-in-the-loop / agent inbox UX**: LangChain's **Agent Inbox**
  (https://github.com/langchain-ai/agent-inbox) is the canonical OSS pattern — agents raise
  `HumanInterrupt` requests, the inbox returns `HumanResponse`, and the agent consumes zero resources
  while waiting (durable interrupt, no polling/WebSocket farm). The general lesson from 2026 writing:
  *hard-blocking on a browser session breaks for background agents; approvals must accumulate in an
  inbox and be answerable asynchronously.* Cf. OpenAI Agents SDK `needsApproval` →
  `RunToolApprovalItem` + `interruptions[]`
  (https://openai.github.io/openai-agents-js/guides/human-in-the-loop/).

---

## Section G — Observability & telemetry tooling

### G1. OpenTelemetry GenAI semantic conventions (agent spans)
**[VERIFIED]** https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md ·
registry: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/ ·
2026 overview post: https://opentelemetry.io/blog/2026/genai-observability/

Span names (operations): `create_agent`, `invoke_agent` (client — remote agent services; and internal
— in-process), `invoke_workflow`, **`plan`** ("agent planning or task decomposition phase"),
`execute_tool`. Canonical trace shape: a top-level `invoke_agent` span with child `chat` spans per LLM
call and `execute_tool` spans per tool invocation.

Key attributes (all still marked **Development / experimental** as of Aug 2026):
```
gen_ai.operation.name      gen_ai.provider.name
gen_ai.agent.name          gen_ai.agent.id       gen_ai.agent.description   gen_ai.agent.version
gen_ai.conversation.id     gen_ai.data_source.id gen_ai.output.type
gen_ai.request.model       gen_ai.request.choice.count
gen_ai.request.max_tokens  gen_ai.request.temperature
gen_ai.usage.input_tokens  gen_ai.usage.output_tokens
gen_ai.tool.definitions    error.type
```

**Why it matters:** even with a local SQLite trace store, naming your columns after these gives you a
free upgrade path to any OTel backend later, and `plan` / `invoke_agent` / `execute_tool` map cleanly
onto phase / agent-call / tool-call. Note the convention has **no first-class concept of a "phase"
with a pass/fail gate** — that's yours to add.

### G2. Claude Code's built-in telemetry
**[VERIFIED]** https://code.claude.com/docs/en/monitoring-usage

Opt in with `CLAUDE_CODE_ENABLE_TELEMETRY=1`; exports **metrics** (token usage, cost, session counts,
lines of code, commits), **structured log events** (API requests, tool executions, permission
decisions) via the OTel logs signal, and traces over OTLP. Exporters: `otlp` | `prometheus` |
`console`; configure with `OTEL_EXPORTER_OTLP_PROTOCOL` / `OTEL_EXPORTER_OTLP_ENDPOINT`. Default
export intervals: **60s metrics, 5s logs** — note this is too coarse for a live swim-lane UI, which is
an argument for the SSSF-style "tail the stream and write rows yourself" approach for the interactive
view, with OTel as the aggregate/rollup path.

Community stacks: https://github.com/ColeMurray/claude-code-otel (Grafana/Prometheus/Loki bundle) ·
https://signoz.io/docs/claude-code-monitoring/ ·
https://www.dash0.com/guides/monitoring-claude-code-opentelemetry

### G3. Hook-based observability
**[VERIFIED]** https://github.com/disler/claude-code-hooks-multi-agent-observability (~1.5k stars,
Python + Bun/Vue) — "real-time monitoring for Claude Code agents through simple hook event tracking."
Covers all hook event types with event-specific field forwarding and an `--add-chat` flag to include
conversation history; ships hook scripts like `pre_tool_use.py` (blocks dangerous commands),
`post_tool_use.py` (captures results, detects MCP tools), `post_tool_use_failure.py`,
`notification.py`. Same author also has https://github.com/disler/pi-agent-observability and
https://github.com/disler/claude-code-hooks-mastery.

Related: https://github.com/simple10/agents-observe, https://github.com/karanb192/claude-code-hooks.
Hooks receive a `transcript_path` pointing at the session **JSONL**; a common pattern is a PostToolUse
hook registered with `"async": true` appending every event to JSONL with a file lock, then querying
the JSONL with **DuckDB**. Reference: https://code.claude.com/docs/en/hooks

**Trade-off to know:** hooks give you tool-call events *without* wrapping the agent, but they do
**not** give you the compiled prompt. If you need "every compiled prompt" you must either own the
invocation (SDK/subprocess, capture what you sent) or read the session transcript JSONL.

### G4. LLM/agent observability platforms
**[PARTIAL]** — from 2026 comparison round-ups, not vendor primary docs.
- **Langfuse** — the most explicit data model in the space: **traces, observations, sessions, scores**,
  where observations are *typed* (`generation` | `span` | `event`). Tracing + datasets + evals
  (manual or LLM-judge) + prompt management + cost tracking. Strongest self-hostable option; free
  self-hosted with no usage limits. **This four-object model is the one most worth copying.**
- **LangSmith** — full agent-run traces (every step, tool call, intermediate state); 2026 additions
  cluster production failures into prioritized issues and propose fixes. 5k traces/month free.
- **Braintrust** — strongest at structured eval experiments wired into CI, but you must define your
  eval surface upfront; won't surface unknown failures. Generous free tier (1M spans/mo).
- **Arize Phoenix**, **W&B Weave**, **Helicone**, **OpenLLMetry/Traceloop**, **AgentOps**,
  **Laminar** — the rest of the field; Traceloop/OpenLLMetry is the OTel-native instrumentation path.
- **The structural critique, worth heeding:** these tools "were built for LLM monitoring workflows and
  extended to support agents — the underlying data model treats agents as *sequences of LLM calls*
  rather than as *sessions with goal-level outcomes*." That gap is exactly what a phase/gate/envelope
  model fills, and it is the reason a bespoke trace store is defensible here.
  https://www.marktechpost.com/2026/08/09/top-llm-observability-and-evaluation-platforms-in-2026-langfuse-langsmith-braintrust-arize-and-more-compared/ ·
  https://latitude.so/blog/best-ai-agent-observability-tools-2026-comparison

---

# Synthesis

## (a) Cross-cutting patterns everyone converges on

**1. Worktrees won for local isolation; VMs/containers only at the cloud tier.**
Vibe Kanban, claude-squad, ccmanager, Crystal/Nimbalyst, agent-of-empires, Conductor, Archon v0.9,
coder/mux, automaker, agent-kanban — all worktree-per-unit-of-work. The strongest evidence is
**Sculptor reversing** from container-per-agent back to worktrees-first with containers experimental,
and Claude Code shipping **`isolation: worktree`** as subagent frontmatter. Containers/microVMs appear
only where the code leaves your machine (Conductor Cloud on Vercel Sandbox, Copilot on Actions runners,
Codex/Jules/Devin cloud VMs, Kiro's autonomous agent).

**2. A three-level object model: work item → attempt/run → process/turn.**
Everyone independently lands on the same shape, with different words:
- Vibe Kanban: `task → workspace → session → execution_process → coding_agent_turn`
- SSSF: `session (adw_id) → phase → event`
- Linear: `Issue → AgentSession → AgentActivity`
- Symphony: `Issue → Claim → RunAttempt (phases)`
- Paperclip: `issue → checkoutRun/executionRun (heartbeat_runs) → cost_events`
- Archon: `workflow run → node → node state`
The invariant: **a ticket is not a run.** One ticket has many attempts; each attempt has many steps.
Anything that collapses these two loses retry history and cost-per-attempt.

**3. Claim/lease semantics, because the queue is now concurrent.**
Beads (`bd ready --claim` + `lease_expires_at` + `heartbeat_at` + `lease_granted_node`), Paperclip
(atomic checkout under an execution lock, fused with budget enforcement), Symphony
(`Unclaimed → Claimed → Released`), agent-kanban (atomic race-free claims + Ed25519 agent identity),
Agent Teams (file-locking on a shared task list), the C-compiler experiment (lock files in
`current_tasks/`). **Stale-claim detection is universal** (Beads heartbeats, agent-kanban's 2h,
Linear's 30-min stale, Symphony's `Stalled` phase).

**4. Typed handoffs between phases, verified after the fact.**
SSSF envelopes + gates; spec-kit's `[NEEDS CLARIFICATION]` markers and Constitution Check; Kiro's EARS
+ per-task requirement back-refs; task-master's `acceptanceCriteria` + `scopeBoundaries`; BMAD's
readiness gate (PASS/CONCERNS/FAIL) and Always/Ask-First/Never; Archon's `triggerRule`; Kilo's
"summary is the source of truth". The universal rule: **agents cannot be trusted to self-report
success, so structure the report and then verify its claims mechanically.**

**5. Deterministic code owns sequencing; agents own bounded judgement.**
SSSF states it as a thesis ("agent proposes, code disposes"); Symphony says "the service remains a
scheduler/runner and tracker reader"; Archon is a YAML DAG; spec-kit added a declarative workflow
engine; Anthropic shipped Dynamic Workflows where the model *writes* a JS orchestration script that
runs **out of context**. Böckeler's guides/sensors × computational/inferential grid is the theory.

**6. Correction-in-session beats restart.**
SSSF re-prompts the live session with a named violation; Anthropic's research post recommends durable
resumable execution over restart-from-scratch; Omnara pivoted its whole product to durable checkpoints;
task-master tracks per-subtask `attempts`/`maxAttempts`; Symphony has exponential backoff with retry
queues. Cold restarts throw away everything the model learned and cost a full context refill.

**7. One human gate, placed early, plus a review queue at the end.**
1Password's **label-as-trigger** is the purest form. Kiro gates all three spec phases. spec-kit added
`type: gate` steps. Archon has `approval:` nodes. Linear has `elicitation`. GitHub models
`waiting_for_user` as a first-class task state. LangChain's Agent Inbox is the canonical async UX.
The consensus shape: **qualify the ticket → run unattended → land in a review queue with evidence.**

**8. Cost is finally first-class.**
coder/mux has a costs tab; Paperclip has `budget_policies` / `budget_incidents` / `cost_events` and
pauses agents on breach; SSSF itemizes per-component spend per phase and sums across retries; Claude
Code emits `cost_usd` per API request with `query_source`/`agent.name` attribution and supports
`maxBudgetUsd`; "Factory In A Box" issues a **$50-capped per-run key, revoked at teardown**.
Anthropic's own numbers set the stakes: **multi-agent uses ~15× the tokens of chat**, and the
C-compiler run cost just under **$20,000**.

**9. Everyone streams a normalized event, and the normalization is the hard part.**
Vibe Kanban's `NormalizedEntryType`/`ActionType` (N CLIs → one schema), SSSF's ten event types, Linear's
five activity types, OTel GenAI's `invoke_agent`/`plan`/`execute_tool`. The shared insight: **the
transport is boring (poll a table, or SSE) and the schema is where the value is.**

**10. Plan-approval is bimodal, and the unattended case is nearly unsolved.**
Hard gates exist (Factory Missions require explicit sign-off; Jules blocks on a plan with a
`requirePlanApproval` flag; Devin gates only when confidence is low) or there is no gate at all (Codex
cloud, Copilot, Cursor cloud agents, Codegen, Ona). Only **Jules** solves the deadlock a personal
factory will actually hit — a human who walks away — with an **auto-approve timer plus a "Planning
Critic" second agent** that critiques the plan pre-execution (claimed 9.5% fewer task failures).

**11. Artifact → reasoning backlinks are the highest-leverage observability feature.**
Copilot links **every commit back to its session log**; Devin has diff-line and message permalinks;
Codegen links each PR back to the originating request; Cursor requires agents to attach **demo
artifacts** (screenshots, video, logs) to the PR. This is what makes review cheap, and it is a
one-column change (store `phase_id` on every commit/artifact you emit).

**12. Retry budgets should be named policy, not emergent behaviour.**
Codegen's CI auto-fixer does **3 attempts, then escalates to a human** — the only explicit budget found.
Compare Copilot (hard-stops at 59 minutes), Codex (no retry orchestration at all), and Charlie V2
("recovers from partial failures and follows through to merge"). Put the number in a config file.

## (b) Gaps nobody handles well

**1. Design/spec artifacts have no lifecycle.** Every SDD tool writes markdown into a folder. Almost
nobody versions the spec against the code, detects drift, or answers "which shipped code implements
requirement FR-003?" spec-kit's `converge` and OpenSpec's **delta specs** are the only two real
attempts, and neither is a data model — they're prompts. *Your Designs object with real
ticket↔requirement↔diff links would be genuinely novel.*

**2. Nobody links the compiled prompt to its provenance.** Claude Code will log the raw request body;
Langfuse will version a prompt template. **Nothing** answers "this exact prompt was assembled from
CLAUDE.md v7 + these 3 rules files + this skill + this ticket body." Prompt-lineage capture is an open
problem and is exactly what "see every compiled prompt" should mean.

**3. Review is the bottleneck and no tool reduces the *cost* of reviewing.** Every product optimizes
producing PRs; the review UI is universally "here's a diff." The measured consequences are severe (PR
volume 25M→90M/month; Jazzband shut down; curl killed its bug bounty; practitioners cap out at 4–8
concurrent worktrees *on review*, not compute). The best ideas found are peripheral: 1Password's
**uncertainty flagging in the PR body**, SSSF's **gate evidence** (`{item, ok, note}`), Crystal's
**per-prompt diff**, and Böckeler's **sensors**. Nobody has assembled them.

**4. Cross-run learning is absent.** Runs are isolated. Nothing feeds "the reviewer rejected this
pattern three times last week" back into the planner. Beads' `bd remember` and semantic compaction, and
Ruflo's namespaced memory with TTL, are the only serious attempts — and they're memory stores, not
learning loops. Anthropic's post explicitly recommends letting Claude rewrite its own prompts
(40% time reduction) and nobody productized it.

**5. Multi-lens review is asserted, never structured.** Everyone says "reviewer agent." Nobody models
*lenses* (security / perf / UX / product-intent / maintainability) as separate scored passes with
independent verdicts. Xebia's "reviewing agents counter bias," the SDD world's Critique-vs-Verify
split, and Anthropic's "adversarial verification" pattern all gesture at it. `ReviewOutput.findings
[{requirement, met, evidence}]` is the closest concrete schema in existence.

**6. The planning interview is nobody's product.** Your "grill me" interrogation has essentially no
prior art. spec-kit's `/clarify` and `[NEEDS CLARIFICATION]` markers, Kiro's `userInput` gate, and
BMAD's HALT-on-unanswered-questions are the closest — all single-shot, none adversarial, none
multi-perspective. *This is the second genuinely novel piece of your design.*

**7. Failure is under-modeled.** Most systems have `failed` and nothing else. The good exceptions are
worth copying: Claude Code's `terminal_reason` (`completed | max_turns | hook_stopped |
budget_exhausted | api_error`), Symphony's `Failed | TimedOut | Stalled | CanceledByReconciliation`,
GitHub's `idle | waiting_for_user | timed_out`. Hung agents are a specific, common, near-invisible
failure — SSSF's `processes` table (adw_id → pid → command) is the only clean answer found.

**8. Docs/wiki maintenance is the least-served phase.** SSSF has a `documenter`; Devin has DeepWiki;
Factory has a Knowledge droid. Nobody models doc staleness, doc↔code links, or "which docs does this
diff invalidate." Your librarian is the third under-served piece.

## (c) The 3–5 projects most worth studying closely

**1. disler/super-simple-software-factory** — https://github.com/disler/super-simple-software-factory
Your stated inspiration, and it earns it: the phase/lane model *is* the swim-lane view, the seven-table
SQLite schema *is* your observability store, and the "poll one events table on a rowid cursor" design
means you can ship a live UI in an afternoon. Read `references/observability.md` and
`adw_modules/data_types.py` line by line. Also read its **sequel**,
`inkwell-agent-sandboxes-and-software-factory`, for the isolation + budget-capped-credential layer the
first one deliberately omits.

**2. Vibe Kanban (BloopAI/vibe-kanban)** — https://github.com/BloopAI/vibe-kanban
Sunsetting, Apache-2.0, and therefore free to mine. Three things: (i) the `NormalizedEntry` /
`ActionType` / `ToolStatus` schema, which is the best-engineered "N agent CLIs → one event stream" in
existence; (ii) `ExecutorAction.next_action` as a linked list, which gives you pipelines and
dependencies in ~50 lines; (iii) **the migration history itself** — watching `task_attempts` split into
`workspaces` + `sessions` tells you exactly which modelling mistake to skip.

**3. Beads (gastownhall/beads)** — https://github.com/gastownhall/beads · https://beads.gascity.com
The most thought-through *ticket* model for agents: 19 typed dependency edges, ready-work as a
recursive-CTE SQL view rather than a heuristic, atomic `--claim` with leases/heartbeats, and **semantic
compaction as graceful decay of closed issues**. Even if you don't adopt Dolt, adopt the graph
semantics, the `ready` projection, and the `discovered-from` edge (agents *find* work mid-run and
nothing else models that).

**4. Archon v0.9 (coleam00/Archon)** — https://github.com/coleam00/Archon
The closest published thing to your architecture: a YAML DAG of typed nodes over SQLite, per-node
**`isolation: worktree`**, a resumable **`approval`** node that pauses the run, and Airflow-style
`triggerRule` (`all_success | one_success | none_failed_min_one_success | all_done`). It answers the
"how do I put a human gate inside a graph without blocking a process" question that SSSF punts on.

**5. Linear's Agent Session API** — https://linear.app/developers/agents
Not to integrate with — to copy the vocabulary. `AgentSessionStatus{pending, active, awaitingInput,
complete, error, stale}` and `AgentActivityType{thought, action, elicitation, response, error}` with
`ephemeral` on the noisy two is the best-designed agent-progress protocol in the industry, and
**delegate ≠ assignee** plus **status derived from the last activity** are two ideas you want on day
one. Pair with **OpenAI Symphony's `SPEC.md`** (https://github.com/openai/symphony) for the
complementary half: separating *claim state* from *tracker state*, and "success = reached the next
handoff state."

*Honourable mentions to read but not study:* Claude Code **Dynamic Workflows** docs (what Anthropic
gives you in-box, and its session-scoped limits), Böckeler's **harness engineering** article (the theory
you're implementing), and Dex Horthy's **intentional compaction** talk (the 40–60% context rule).

## (d) Data models worth copying

**The spine (SSSF, adapted).** Seven tables, one polled events table, phases default to `fail`:
```sql
sessions(run_id PK, name, request, status, engineer, started_at, ended_at, total_tokens, total_cost, archived)
phases(phase_id PK, run_id, seq, name, kind, owner, description, status DEFAULT 'fail',
       attempt, retries, error, started_at, ended_at)
events(event_id PK, run_id, phase_id, parent_id, type, name, payload_json, tokens, started_at, ended_at)
envelopes(envelope_id PK, run_id, phase_id, agent, output_type, payload_json, valid, attempt, created_at)
gate_results(id PK, run_id, phase_id, attempt, gate, passed, violations_json, checks_json, created_at)
processes(id PK, run_id, kind, name, pid, command, started_at, ended_at)
agent_sessions(run_id, agent, coding_agent, model, color, session_id,
               context_tokens, context_window, created_at, last_used_at, PRIMARY KEY(run_id, agent))
```
`PhaseKind = engineer | agent | code` — these are literally the swim lanes.
`PhaseStatus = queued | running | success | fail`.
Events: `phase_start | phase_end | agent_start | agent_end | tool_call | handoff | gate_pass |
gate_fail | log | error`; `parent_id` nests; only `tool_call` fills `ended_at`.
The whole transport: `SELECT … FROM events WHERE run_id=? AND rowid>? ORDER BY rowid LIMIT 500;`

**The envelope + gate contract (SSSF).**
```python
class EnvelopeBase(BaseModel):
    status: Literal["success", "fail"]
    summary: str = ""
    artifacts: list[str] = []
    notes_for_next_agent: str = ""

class ReviewOutput(EnvelopeBase):
    approved: bool = False
    findings: list[ReviewFinding] = []   # {requirement: str, met: bool, evidence: str}
    blocking: list[str] = []
```
```python
GateCheck  = {item: str, ok: bool, note: str}   # note is the evidence AND the failure reason
GateReport = {checks: [GateCheck]}              # violations derived from failed checks
```

**Agent progress protocol (Linear).**
```graphql
enum AgentSessionStatus  { pending  active  awaitingInput  complete  error  stale }
enum AgentActivityType   { thought  action  elicitation  response  error  prompt }
enum AgentActivitySignal { auth  continue  select  stop }
# ActionContent { action, parameter, result, resultData }
# AgentActivity.ephemeral: only thought/action may be ephemeral
```
Rules to copy: agents never set status (it's derived from the last activity); only one terminal
`response` per session; `elicitation` is the *only* thing that flips a session to `awaitingInput`.

**Normalized tool events across heterogeneous agents (Vibe Kanban).**
```rust
ActionType  = FileRead | FileEdit{path,changes} | CommandRun{command,result,category}
            | Search | WebFetch | Tool{..} | TaskCreate{description,subagent_type}
            | PlanPresentation{plan} | TodoManagement{todos}
ToolStatus  = Created | Success | Failed | Denied{reason} | PendingApproval{approval_id} | TimedOut
ExecutorAction { typ, next_action: Option<Box<ExecutorAction>> }   // the pipeline engine
```

**Ticket graph (Beads).** Status `open | in_progress | blocked | deferred | closed | pinned | hooked`;
workflow edges `blocks`, `parent-child`, **`conditional-blocks`** (B runs only if A fails),
**`waits-for`** (fan-out gate); association edges `related`, **`discovered-from`** (work the agent found
mid-run). Ready-work as a persisted `is_blocked` projection + a recursive-CTE view, with atomic claim +
`lease_expires_at` / `heartbeat_at` / `lease_granted_node`.

**Run-attempt phases and failure taxonomy (Symphony + Claude Code).**
```
Claim:   Unclaimed -> Claimed(Running | RetryQueued) -> Released
Attempt: PreparingWorkspace, BuildingPrompt, LaunchingAgentProcess, InitializingSession,
         StreamingTurn, Finishing, Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation
terminal_reason: completed | max_turns | hook_stopped | budget_exhausted | api_error
```

**Cost record (Claude Code SDK result message).** Persist per phase, per attempt:
`{total_cost_usd, usage, modelUsage:{[model]: ModelUsage}, num_turns, duration_ms, duration_api_ms,
ttft_ms, permission_denials, terminal_reason}`.
⚠️ **`usage` excludes subagents — use `modelUsage`**; `total_cost_usd` is a client-side estimate.
And split *spend* (monotonic, summed over retries, per component input/output/cache_read/cache_write)
from *context occupancy* (`context_tokens` vs `context_window` after the last valid turn).

**Task fields worth adding to your Ticket (task-master + Paperclip).**
`scopeBoundaries{included, excluded}` · `relevantFiles[{path, description, action:'create'|'modify'|'reference'}]` ·
`acceptanceCriteria` · `testStrategy` · `review_policy ∈ {anyone, not_creator, human_only}` ·
`assigneeAgentId` **and** `assigneeUserId` side by side.

**Spec/Design document shape.** Kiro's fixed `design.md` skeleton (Overview · Architecture · Components
and Interfaces · Data Models · Error Handling · Testing Strategy) + EARS acceptance criteria
(`WHEN … THEN … SHALL …`) with per-task back-refs (`_Requirements: 2.1, 3.3_`); BMAD's
`<frozen-after-approval>` intent block, Always/Ask-First/Never tiers, and a **900–1300 token budget
("above 1600 = high risk of context rot")**; OpenSpec's **delta specs**
(`## ADDED / MODIFIED / REMOVED / RENAMED Requirements`) for the second and hundredth change.

**HITL event (disler's observability repo).**
`HumanInTheLoop{question, type: 'question'|'permission'|'choice', choices, timeout}` with status
`pending | responded | timeout | error` — drop-in for an approvals inbox.

**Telemetry naming (OTel GenAI).** Even in local SQLite, name columns after
`gen_ai.operation.name` (`invoke_agent` | `plan` | `execute_tool`), `gen_ai.agent.name/id`,
`gen_ai.conversation.id`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` /
`gen_ai.usage.output_tokens`, `error.type`. Free upgrade path later; all still marked *Development*.

**Autonomy ladder + network policy (Factory + Codex).** Two enforcement ideas worth copying wholesale:
Factory's graded `--auto low|medium|high` where **exceeding the level aborts with a non-zero exit and no
partial changes** (a precondition, not a mid-run prompt); and Codex's **two-phase network model** —
internet ON during setup, air-gapped during the agent phase, and if egress is allowed it is
allowlist + **GET/HEAD/OPTIONS only**, so exfiltration is structurally impossible rather than forbidden
by prompt. **Secrets exist only during setup and are stripped before the agent runs.**

**Deny rules as a role definition (Charlie Daemons).** A background role defined by what it may *not* do
("cannot merge pull requests", "cannot modify application logic") is far easier to trust — and to
review — than one defined by what it should do. Pairs exactly with SSSF's `writes:` boundary.
