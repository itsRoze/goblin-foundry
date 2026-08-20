# Deep-dive: disler/super-simple-software-factory + claude-code-hooks-multi-agent-observability

**Research date:** 2026-08-18
**Method:** both repos cloned via `git clone --depth 1` and read directly from source (plus the `example` branch of SSSF). Web research for IndyDevDan's vocabulary. Nothing in the "from source" sections is inferred — inferences are marked **[INFERENCE]**.

**Repos read:**
- https://github.com/disler/super-simple-software-factory (branch `main` = the skill alone; branch `example` = a repo with the factory stamped in)
- https://github.com/disler/claude-code-hooks-multi-agent-observability

**Primary video:** https://youtu.be/haUfb1ievTE ("Super Simple Software Factory", linked from the README)

---

## 0. Three corrections to the brief up front

These matter because they change what is actually reusable:

1. **It does NOT run Claude Code.** SSSF v1 runs **`pi`** (https://github.com/mariozechner/pi-coding-agent) exclusively. `coding_agent: claude_code` is schema-valid but `adw_modules/agent_cc.py` is a stub that raises `NotImplementedError`. The intended v2 shape is documented in that file's docstring as `claude -p --output-format stream-json --resume <session_id>`. See §4.
2. **The visualizer is on port 4600, not 4601.** The README and the stamped `justfile` both say server `:4600` plus a Vite dev server. (The subagent verified the exact vite port — see §1.6.)
3. **There is no ticket system, no worktrees, no branches, no human-in-the-loop.** The README says so explicitly: *"this runs on your current branch. For real work you want a branch per run, a sandbox around the agent, and a merge step at the end."* Those are exactly the gaps your factory has to fill. See §6.

Also note the repo is deliberately **not** a product: *"This is a starting point, not a product. Nothing here is meant to survive contact with your codebase unchanged."*

---

## 1. Architecture of super-simple-software-factory

### 1.1 The one-line thesis

> "An ADW script (AI Developer Workflow) owns sequencing, retries, and acceptance. Agents work inside named phases. Typed JSON envelopes carry context across the seams. Every event streams into SQLite while it is still happening. **Agent proposes, code disposes.**"
> — README.md

And the design rule everything falls out of:

> "**code owns sequencing, retries, and acceptance, and the agent owns only the work inside one bounded phase**. Everything else falls out of that one line. Phases become the unit of the trace. Envelopes become the only way context crosses a seam. Gates become the definition of done. A correction becomes cheaper than a restart, because the session is still alive."

### 1.2 The product is a Claude Code Skill

The entire factory ships as `.claude/skills/sssf/` and is **stamped** into a target repo by `uv run .claude/skills/sssf/scripts/install.py`. Two install paths: agentic (`/sssf install` inside Claude Code, which makes the agent read `cookbooks/install.md`) or manual.

```
.claude/skills/sssf/
├── SKILL.md                        # hard rules + request routing table
├── cookbooks/                      # 9 orchestrator playbooks, lazily loaded
│   ├── install.md  create_adw.md  update_adw.md  create_config.md
│   ├── update_config.md  update_modules.md  run_adw.md
│   ├── how_to_prompt_for_the_eng.md  sssf_overview.md
├── references/                     # deep specs: config.md, handoff.md, observability.md
├── scripts/                        # install.py, make_config.py, make_adw.py
├── apps/visualizer/                # the read-only trace UI (Vue + Vite on Bun)
└── templates/                      # EXACTLY what install.py stamps
    ├── sssf.config.yaml            # the starter roster
    ├── prompt_engineering/{agent}/ # system.md + user.md per agent
    ├── harness_engineering/        # pi extensions (subagents.ts, themeMap.ts)
    ├── env.sample, justfile
    └── adws/
        ├── adw_*.py                # the twelve starter workflows
        └── adw_modules/            # ALL low-level logic; ADW scripts stay thin
```

`install.py` is idempotent — it skips existing files and reports what it skipped, doubling as a drift check. `--force` overwrites everything **including your config and prompts**.

**Worth stealing:** the skill *is* the operator interface. `SKILL.md` routes a request to one of nine cookbooks that are lazily loaded, so the orchestrating agent doesn't burn context on the whole manual. `SKILL.md` even contains an anti-pattern warning about volunteering state:

> "**Volunteered state is guessed state.** An orchestrator that improvised a status board queried a `runs` table and a `payload` column — neither exists (`sessions`, `payload_json`)... Probing to look prepared is how you end up confidently wrong in your first message."

### 1.3 What lands in the target repo

| Path | Source | Tracked in git? |
|---|---|---|
| `adws/adw_sssf_config/sssf.config.yaml` | `templates/sssf.config.yaml` | yes — your agent roster |
| `adws/adw_*.py` | `templates/adws/` | yes — twelve starter workflows |
| `adws/adw_modules/` | `templates/adws/adw_modules/` | yes — all low-level logic |
| `adws/adw_data/prompt_engineering/` | `templates/prompt_engineering/` | yes — **your prompts live here** |
| `adws/adw_data/harness_engineering/` | `templates/harness_engineering/` | yes — pi extensions |
| `.env.sample`, `justfile` | templates | yes |
| `adws/adw_data/sessions/`, `sssf.db` | created at runtime | **no, gitignored** |

Verified on the `example` branch: `.gitignore` contains `adws/adw_data/sessions/` and `sssf.db*`. So **no real trace data is committed anywhere** — you cannot inspect a real run's DB from the repo; only the specs/app_docs the runs produced.

### 1.4 The session/run model

A **run** = one `adw_id` (8 hex chars, `new_id(8)`). `session.ensure(cfg, adw_id)` is *pin-or-create*: omit the id and a fresh one is minted and printed; supply it and the run **joins** the existing session — same dirs, same `context_handoff/`, and **each agent resumes its existing context window** via `agent_map.json`. That is how workflows chain:

```bash
uv run adws/adw_plan.py "add a /health endpoint"              # prints adw_id a1b2c3d4
uv run adws/adw_build_test.py "implement the plan" --adw-id a1b2c3d4
```

Session directory layout (from `references/handoff.md`):

```
adws/adw_data/sessions/{adw_id}/
├── agent_map.json          agent name -> coding-agent session_id + model
├── context_handoff/        the ONE place agents write files for the agents that follow
└── {agent_name}/
    ├── prompts/            exact prompts sent (system.md + user.md), saved BEFORE execution
    ├── pi_sessions/        pi's own session state for this agent
    ├── raw_output.jsonl    full JSONL stream from the coding agent, appended live
    └── envelope.json       the final valid-JSON response — captured, validated, persisted by code
```

`agent_map.json` records the model each session was created with; **if config drift changes an agent's model, that agent starts a fresh session** rather than doing a bad resume.

### 1.5 Phases: the one primitive

Three **kinds** = three swim lanes: `engineer` (the human lane), `agent` (`ph.call(...)`), `code` (a deterministic step). Statuses: `queued | running | success | fail`.

```python
PhaseKind   = Literal["engineer", "agent", "code"]
PhaseStatus = Literal["queued", "running", "success", "fail"]

class PhaseParams(BaseModel):
    name: str          # short id, unique within the run: "plan", "build"
    kind: PhaseKind    # which lane the block renders in
    owner: str         # engineer's name, "git", or an agent name from config
    description: str   # REQUIRED: what this phase does and why
    retries: int = 0   # agent phases: gate-failure retries via continue
```

**A phase description is validated at construction time** — a description that merely restates the name is rejected. This is a genuinely clever bit of design pressure:

> "A phase name identifies; a description explains. Both are required. The description is the only sentence the trace, the console, and the phase block in the UI ever show about intent... `commit_plan: "Commit the plan"` tells a reader nothing they could not already see, so an echo is rejected the same way a blank one is."

The phase context manager (`adw_modules/runner.py`) is where "success must be earned" lives — every phase starts at `fail`, only a clean exit flips it to `success`, and any exception writes `error` + `phase_end(fail)` events, finalizes the session, and re-raises.

**Two acceptance questions, not one.** `run.finish(accepted=..., reason=...)` is mandatory in every ADW (hard rule 10). The docstring explains the bug it was written to fix:

> "Every phase must have passed, AND the ADW's own acceptance test must hold. They are different questions on purpose: a test phase that ran the suite did its job even when the suite came back red, so the PHASE succeeds while the RUN must not. This replaces a `succeeded` property that answered only the first question — and, being a property with side effects, wrote the session status and printed the banner before the caller's `and test.passed` was ever evaluated. A run whose suite never passed was recorded green in the db, on the terminal, and in the UI while exiting 1."

**Steal this**: one call settles DB status + banner + exit code together so they cannot disagree.

### 1.6 The twelve starter ADWs

Every ADW has the same CLI shape:
```bash
uv run adws/adw_*.py "<prompt or path/to/prompt.md>" [--config ...] [--adw-id a1b2c3d4]
```

| ADW | Chain | Reach for it when |
|---|---|---|
| `adw_prompt` | engineer → \<agent\> | one agent, one prompt, `--agent NAME` picks who |
| `adw_scout` | engineer → scout | read-only recon, nothing changes |
| `adw_plan` | engineer → planner | you want the spec before any code |
| `adw_build` | engineer → builder | the plan already exists |
| `adw_quality` | engineer → code(quality) | lint, typecheck, build, **no agents at all** |
| `adw_plan_build` | planner, builder, git(commit) | small, well-understood work |
| `adw_build_test` | builder, code(test), bounded fix loop | there is a suite to satisfy |
| `adw_build_review` | builder, reviewer, bounded revise loop | "is this what was asked for" matters more than "does it run" |
| `adw_plan_build_test` | plan, build, code(test), git(commit) | the standard chain |
| `adw_plan_build_test_quality` | same, plus lint/typecheck/build gates | the repo has quality commands worth enforcing |
| `adw_document` | code(git diff), documenter | write up what just shipped |
| `adw_simple_sdlc` | plan, build, test, review, document | the work is real and its shape is not obvious |

ADW scripts are 40–180 lines on purpose. `adw_simple_sdlc.py` (183 lines) is the reference chain:

```
engineer(request) -> planner -> git(commit_plan)
  -> builder -> code(test) [-> builder(fix) -> code(test) ... bounded MAX_FIX_LOOPS=3]
  -> reviewer [-> builder(revise) -> reviewer ... bounded MAX_REVISION_LOOPS=2]
  -> code(retest, only if a revision changed code)
  -> git(commit_build) -> code(changes) -> documenter -> git(commit_docs)
```

Design decisions embedded in that file worth copying verbatim:
- **Three commits, three authors.** Plan, code, and write-up each get their own commit, and each commit message is the words of the agent that produced it (`commit_message` is a field on `PlanOutput`, `BuildOutput`, `DocumentOutput` separately). *"No agent's sentence is ever reused for another agent's diff."*
- **Testing is code, not an agent.** *"`bun test` is a command, not a judgement call."*
- **Two different questions in order**: the suite asks "does it run"; the reviewer asks "is this what was asked for". Neither can answer the other's.
- **Retest after revision**: *"A revision edited code after the suite last ran, so the green light is stale."*
- **Commit only after verification**: a failed run leaves the plan committed and the tree dirty — *"the spec is a real artifact either way, and the unfinished code stays where the engineer can see it."*
- **The documenter diffs against a baseline pinned before the run's first commit**, not against `main`, because by then the run has moved `main` itself.

### 1.7 The agent roster (config)

`adws/adw_sssf_config/sssf.config.yaml` answers exactly one question per entry: *who is this agent*. **ADW scripts never name a model — they name an agent.** That split is what lets one agent serve many calls.

```yaml
defaults:
  coding_agent: pi
  model: google/gemini-3.6-flash   # provider/model-id; a bare id can match several providers
  thinking: medium                 # off | minimal | low | medium | high | xhigh | max
  harness_engineering: []
  tools: [read, bash, edit, write, grep, find, ls]
  protected_files:                 # no agent may edit the machinery that grades it
    - adws/adw_modules/
    - adws/adw_sssf_config/
    - adws/adw_*.py
  data_dir: adws/adw_data

observability:
  db: adws/adw_data/sssf.db
  poll_ms: 500

agents:
  - name: planner
    model: fireworks/accounts/fireworks/models/kimi-k3
    thinking: high
    color: "#a78bfa"               # this agent's lane swatch in the trace
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering:
      system: adws/adw_data/prompt_engineering/planner/system.md
      user: adws/adw_data/prompt_engineering/planner/user.md
    harness_engineering:
      - adws/adw_data/harness_engineering/subagents.ts   # this agent can spawn subagents
    writes:                        # the plan is all it may leave in the repo
      - specs/
    tools: [read, grep, find, ls, bash, write,
            subagent_create, subagent_continue, subagent_list, subagent_remove]
```

Five starter agents: `planner`, `builder`, `scout` (read-only recon), `reviewer`, `documenter`. **There is deliberately no tester** — running a suite is a known command, therefore code (SKILL.md hard rule 8).

Roster colors, per config: planner `#a78bfa`, builder `#22d3ee`, scout `#fbbf24`, reviewer `#fb7185`, documenter `#e879f9`.

**`tools` vs `writes` — the single sharpest idea in the repo.**

> "**`tools` is a capability list. `writes` is the boundary.** They are not the same thing, and the difference matters: `bash` runs anything, including `git checkout`, and `write` reaches any path. So 'this agent changes nothing' is enforced in code, after every call, by comparing the repo before and after."

`permissions.py` explains it was written from a real incident:

> "`bash` runs anything. A builder handed bash to run a test suite can also run `git checkout adws/` — which is not hypothetical: one did, discarding uncommitted changes to the very quality check it was about to be judged by."

Semantics of `writes`: `None` = unrestricted (except roster-wide `protected_files`); `[]` = read-only w.r.t. the repo; `[...]` = only those (trailing `/` = directory prefix, `*` = glob that does **not** cross `/`, else exact path). Enforcement is **change-set diffing**, not write-watching:

```python
def snapshot(run) -> dict[str, str]:
    """Fingerprint every path the working tree currently differs on."""
    # git diff HEAD --numstat  ->  path: "adds,dels"
    # git ls-files --others --exclude-standard  ->  path: "untracked"

def changed_paths(before, after) -> list[str]:
    """Every path whose state differs — appeared, vanished, or was rewritten."""
    return sorted({p for p in set(before) | set(after) if before.get(p) != after.get(p)})
```

> "Comparing change-sets, rather than watching for writes, is what catches the `git checkout` case: a path that was modified before the agent ran and is clean afterwards has been reverted, and a reversion is a modification."

A breach is **not** a gate violation — it cannot be corrected by re-prompting because the write already happened. It rolls back what the agent introduced, aborts the phase, and names every offending path. It deliberately does **not** roll back paths that were already dirty before the agent ran (*"discarding it to tidy up would be the same harm this module exists to prevent, committed by the cleanup instead of the agent"*), and if the agent reverted an engineer's uncommitted work it reports `REVERTED-BY-AGENT (uncommitted work lost, cannot restore)`.

Every agent can always write under `data_dir` — *"a read-only agent is read-only with respect to the REPO, never mute."*

### 1.8 The visualizer stack

- **Backend:** Bun serving `server/index.ts` on **port 4600**, read-only SQLite connection (WAL) against `sssf.db`. One write exception: `POST /api/sessions/:adw_id/archive` sets `sessions.archived` (human review triage).
- **Frontend:** Vue 3 + Vite, `bunx vite`.
- **DB target resolution:** `--db` flag → `SSSF_DB` env → `<cwd>/adws/adw_data/sssf.db`. One instance can point at any stamped repo.

```bash
cd .claude/skills/sssf/apps/visualizer && bun install
SSSF_DB=/abs/path/to/your-repo/adws/adw_data/sssf.db bun run server/index.ts &
bunx vite
```

Components: `App.vue`, `SessionsList.vue`, `SessionCard.vue` (472 lines), `SessionTrace.vue` (858 lines — the waterfall), `PhaseDetail.vue` (1265 lines — the per-phase pane), `PhaseDots.vue`, `StatChip.vue`, `StatusChip.vue`, `DetailSection.vue`. Libs: `api.ts`, `events.ts`, `format.ts`, `models.ts`, `router.ts`, `markdown.ts`, `highlight.ts`. `public/models/` holds provider logos (claude, openai, gemini, kimi, zai) — the UI badges each phase with its model's provider.

### 1.9 How the UI gets live updates — **polling, not push**

This is an explicit, load-bearing architectural choice:

> "**The UI never receives pushes.** No ingest endpoint, no WebSocket, no backfill or dedup logic."

> "One data path, no exceptions: **agents write to SQLite, readers poll SQLite.**"

The entire transport is one cursor query at `observability.poll_ms` (default 500ms):

```sql
SELECT ... FROM events WHERE adw_id = ? AND rowid > ? ORDER BY rowid LIMIT 500;
```

Keep the highest `rowid` as the next cursor. **Live view and full history are the same query at different cadence** — which is why there is no separate replay path. Every connection opens WAL so reads never block running writers.

Streaming works because `agent_pi.py` tails pi's JSONL stdout **line by line** and the tracer inserts each event while the agent is still working:

> "Streaming is solved by construction... never batched at phase end (verified in the first smoke run: tool calls visible mid-run). Everything downstream is a poll → render."

---

## 2. The exact event schema

### 2.1 Ten event types

From `references/observability.md` and `data_types.EventRecord`:

| Type | Emitted when |
|---|---|
| `phase_start` | a `run.phase(...)` block is entered |
| `agent_start` | a coding agent is spawned or resumed for `ph.call(...)` |
| `tool_call` | a tool returns — **one event per real call**, named `bash: ls -la src` |
| `handoff` | an envelope crosses from one agent to the next |
| `gate_pass` | a gate found no failed checks |
| `gate_fail` | a gate found at least one failed check |
| `log` | an explicit `ph.log(...)` from the ADW script (also every console line) |
| `agent_end` | the agent's run completes; carries `cost`, `usage`, `context_tokens`, `context_window` |
| `phase_end` | the block exits; carries the resolved status |
| `error` | a raise inside a phase block |

### 2.2 The event record type

```python
class EventRecord(BaseModel):
    """One traced event, always logged against adw_id + phase."""
    adw_id: str
    phase_id: str = ""
    type: str        # phase_start | agent_start | tool_call | handoff | gate_pass
                     # | gate_fail | log | agent_end | phase_end | error
    name: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    parent_id: str = ""
    tokens: Optional[int] = None
    # Spans: set both when an event covers real elapsed time (a tool call), so
    # the UI lays it out on a time axis without parsing payload JSON.
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
```

**Only `tool_call` spans time** — it fills both `started_at` and `ended_at`. Every other type is a point in time (`ended_at` NULL). *"Lay tool calls out on a time axis from those columns, never by parsing `payload_json`."*

### 2.3 Payloads per type (from `agents.py` / `runner.py`)

- `phase_start` → `{kind, owner, description}`
- `agent_start` → `{model, thinking, color, session_id, coding_agent, purpose, tools, harness_engineering}`
- `tool_call` → `{tool, tool_call_id, args, result_snippet, ok, duration_ms, agent}`
- `gate_pass` / `gate_fail` → `{attempt, violations, checks: [{item, ok, note}]}`
- `handoff` → `{artifacts, summary}`
- `agent_end` → `tokens=<phase total>`, payload `{cost, usage: <UsageBreakdown>, context_tokens, context_window}`
- `phase_end` → `{status}`
- `error` → `{error}`; also `name="permission_breach"` → `{agent, error, writes, protected_files}`; also `name="not_accepted"` → `{reason}`
- `log` → arbitrary kwargs from `ph.log(**payload)`, or `{message, level}` from the console

### 2.4 Storage: **both** JSONL files and SQLite

> "**Files are the raw record** (`raw_output.jsonl` streams, `envelope.json`, `agent_map.json`); **SQLite (`sssf.db`) is the queryable mirror** the UI reads. `tracer.py` writes both. Losing the db loses nothing that can't be rebuilt from files."

Every event is appended to `adws/adw_data/sessions/{adw_id}/events.jsonl` **and** inserted into `events`:

```python
def event(self, record: EventRecord) -> str:
    event_id = f"evt_{new_id(12)}"
    ts = now_iso()
    line = {"event_id": event_id, "ts": ts, **record.model_dump()}
    with self.events_jsonl.open("a") as f:
        f.write(json.dumps(line) + "\n")
    self.conn.execute(
        "INSERT INTO events (event_id, adw_id, phase_id, parent_id, type, name,"
        " payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (event_id, record.adw_id, record.phase_id, record.parent_id, record.type,
         record.name, json.dumps(record.payload), record.tokens,
         record.started_at or ts, record.ended_at))
    return event_id
```

### 2.5 The seven tables — verbatim from `adw_modules/tracer.py`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  adw_id        TEXT PRIMARY KEY,
  adw_name      TEXT,                -- ADW script(s) run, e.g. "adw_plan + adw_build_test"
  request       TEXT,
  status        TEXT,                -- running | success | fail
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0   -- review triage, set by the UI; never by a run
);
CREATE TABLE IF NOT EXISTS phases (
  phase_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  parent_id     TEXT,
  type          TEXT,
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id   TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,
  checks_json   TEXT,               -- [{item, ok, note}] — WHAT the gate verified
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  kind          TEXT,                -- 'adw' (the workflow process) | 'agent' (a coding-agent child)
  name          TEXT,                -- '' for the adw, the agent name for a child
  pid           INTEGER,
  command       TEXT,                -- so a recycled pid is not killed by mistake
  started_at    TEXT, ended_at TEXT  -- ended_at NULL = believed alive
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  adw_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER,           -- window occupancy after the agent's last turn
  context_window INTEGER,           -- the model's ceiling; 0/NULL = unknown
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (adw_id, agent)
);
```

**No indexes are declared** beyond the primary keys — the cursor query rides `rowid`. **[INFERENCE]** at the scale of a personal factory that's fine; a multi-project ticket system would want `events(adw_id, rowid)` and `phases(adw_id, seq)`.

Additive migrations are handled explicitly because `CREATE TABLE IF NOT EXISTS` never revisits an existing table:

```python
MIGRATIONS = [("agent_sessions", "color", "TEXT"),
              ("gate_results", "checks_json", "TEXT"),
              ("sessions", "adw_name", "TEXT"),
              ("agent_sessions", "context_tokens", "INTEGER"),
              ("agent_sessions", "context_window", "INTEGER"),
              ("sessions", "archived", "INTEGER DEFAULT 0")]
```

WAL pragmas on **every** connection, reader and writer:
```sql
PRAGMA journal_mode=WAL;  PRAGMA synchronous=NORMAL;  PRAGMA busy_timeout=5000;
```

**Derived, never stored:** phase durations (`ended_at − started_at`), session phase-progress, lane layout (`kind` + `owner`).

### 2.6 The `processes` table — an underrated idea

> "**A hung agent emits nothing**, which is exactly when you need its pid: no events, no tokens, no output to read. `processes` is the only table that can answer 'what is this run running, and how do I stop it'."

`just procs <adw_id>` lists what's live; `just kill <adw_id>` kills children first, then the parent, and **verifies the recorded `command` still matches the pid** before signalling (pids get recycled). And a killed run finalizes its own trace — `session.ensure` installs SIGTERM/SIGINT handlers that turn the signal into `SystemExit` so the session lands on `fail` with process rows closed instead of reading `running` forever.

### 2.7 Tool-call folding

pi announces one logical tool call across **three** raw events (`toolCall` block in `message_end`, then `tool_execution_start`, then `tool_execution_end`). `ToolCallTracker` folds them into exactly one `tool_call` row, emitted at the end (the only place the result exists), carrying the real span:

```python
record = {
    "tool": tool,
    "tool_call_id": call_id,
    "args": {k: _clip(v, ARG_VALUE_CHARS) if isinstance(v, str) else v for k, v in args.items()},
    "ok": not event.get("isError", False),
    "label": _label(tool, args),          # "bash: ls -la src"
}
# + result_snippet, ended_at, duration_ms, started_at
```

Labels are built from the first present of `PRIMARY_ARGS = ("command", "path", "file_path", "pattern", "query", "url")`, clipped to 80 chars. Args and results are clipped at 20,000 chars each — deliberately generous: *"the UI scrolls, it must not be handed cut-off data."*

---

## 3. Prompts, validation, gates, cost, handoff

### 3.1 Prompt compilation

Two files per agent, paths declared in config:

- `system.md` — **static identity**: Purpose + Instructions only. "One agent, one prompt, one purpose."
- `user.md` — **the task**: `## Variables` (one h3 per incoming datum), `## Task`, then `## Report` (the exact JSON shape).

Rendering is dead simple `{{placeholder}}` string replacement (`adw_modules/prompts.py`, ~20 lines):

```python
def render(template_path, variables: dict[str, str]) -> str:
    text = Path(template_path).read_text()
    for key, value in variables.items():
        text = text.replace("{{" + key + "}}", value)
    return text
```

Exactly three variables are injected:

| Placeholder | Value |
|---|---|
| `{{prompt}}` | the engineer's ask (or the ADW's per-call prompt) |
| `{{previous_envelope}}` | the upstream envelope JSON, from `AgentCall(previous=...)` |
| `{{context_handoff_dir}}` | absolute path to this session's `context_handoff/` |

**Every compiled prompt is saved to disk before execution** — that is where the UI's "22 lines"/"56 lines" display comes from:

```python
def save(directory, name: str, content: str) -> Path:
    """Save the exact prompt sent, before execution — the audit copy."""
```

Called as `prompts.save(agent_dir / "prompts", "system.md", system_text)` and likewise for `user.md`, landing at `sessions/{adw_id}/{agent}/prompts/{system,user}.md`. The VALUE.md description confirms the UI reads these: *"**Compiled prompts** — the exact system and user text that was sent, not a template."*

**Steal this:** save the compiled prompt as a file, before the call, not as a log line after it.

### 3.2 Envelopes — the typed output contract

An agent has **exactly two output channels**:
1. reference files written into `context_handoff/`
2. a final valid-JSON response parsed against the declared output type

> "Context transfers in code, not in conversation."

```python
class EnvelopeBase(BaseModel):
    status: Literal["success", "fail"]   # the only required field
    summary: str = ""
    artifacts: list[str] = Field(default_factory=list)
    notes_for_next_agent: str = ""
```

`status` is load-bearing: an envelope that parses but reports `status="fail"` raises, failing the phase.

Concrete types:

```python
class GenericOutput(EnvelopeBase): pass

class PlanOutput(EnvelopeBase):
    commit_message: str = ""        # for the PLAN FILE itself, not the work it describes

class BuildOutput(EnvelopeBase):
    changed_files: list[str] = Field(default_factory=list)
    commit_message: str = ""

class ScoutFinding(BaseModel):
    file: str
    note: str = ""

class ScoutOutput(EnvelopeBase):
    findings: list[ScoutFinding] = Field(default_factory=list)

class ReviewFinding(BaseModel):
    requirement: str                # the ask, in the requester's words
    met: bool
    evidence: str = ""              # where it lives, or what is missing

class ReviewOutput(EnvelopeBase):
    approved: bool = False          # the verdict; status only says "did the review run"
    findings: list[ReviewFinding] = Field(default_factory=list)
    blocking: list[str] = Field(default_factory=list)

class DocumentOutput(EnvelopeBase):
    document_path: str = ""
    documented_files: list[str] = Field(default_factory=list)
    commit_message: str = ""
```

Plus two **adapters** — deterministic results shaped as envelopes so an agent consumes them through the same door:
- `VerifyOutput(passed, failures)` ← from `quality.as_envelope(result, what)`
- `ChangesOutput(base, changed_files, insertions, deletions, stat, diff_path)` ← from `changes.as_envelope(...)`

> "The consuming agent cannot tell the difference, which is the point."

**The synced triad** (SKILL.md hard rule 2) — the output contract lives in three places and they are one thing:
1. the type in `data_types.py`
2. the JSON example in that agent's `user.md` `## Report` section
3. `output_type=` at the call site

> "**Change one, change all three in the same edit.**"

Listed in the README's failure table as a real failure mode: *"The synced triad drifts → every call burns correction rounds → Grep the type name and fix all three in one edit."* **[INFERENCE]** this is a self-inflicted wound of the design; generating the `## Report` JSON example from the Pydantic schema at render time would eliminate it entirely. Worth doing differently in your factory.

### 3.3 Validation: parse → correct in the SAME session

`JSON_FIX_ATTEMPTS = 2` in `agents.py`. Parsing is tolerant (strips ```json fences, finds first `{` to last `}`), then `model_validate`. On failure:

```python
result = send(
    f"Your response was not valid JSON for the required structure "
    f"({error}). Respond again with ONLY a JSON object with these "
    f"fields: {fields}. No prose, no code fences.")
```

**Nothing restarts.** Because pi treats `--session-id` as create-or-continue, "running an agent" and "continuing it" are the same call:

> "A cold restart throws away everything the agent learned. A correction costs one message."

Every failed attempt is persisted as an **invalid envelope row** (`envelopes.valid = 0`) with the raw text — so the UI can show you the near-misses. This is what produces the UI's "PlanOutput ... valid" line.

### 3.4 Gates

Signature: `gate(envelope, run) -> GateReport`. Gates verify **claims, never predictions**:

> "Nobody knows which files an agent will touch before it finishes, so gates run **after** the fact against the envelope's own declarations."

```python
class GateCheck(BaseModel):
    item: str        # what was checked: a path, a command, a test
    ok: bool
    note: str = ""   # the evidence — "exists, 2.1KB", "exit 0", "not in the diff"

class GateReport(BaseModel):
    checks: list[GateCheck] = Field(default_factory=list)

    def check(self, item: str, ok: bool, note: str = "") -> "GateReport":
        self.checks.append(GateCheck(item=item, ok=ok, note=note))
        return self

    @property
    def violations(self) -> list[str]:
        return [f"{c.item}: {c.note or 'failed'}" for c in self.checks if not c.ok]

    @property
    def passed(self) -> bool:
        return not self.violations
```

**A green gate says *what* it verified**, not just that it passed — `{"item": ".../plan.md", "ok": true, "note": "exists, 454B"}`. That is a genuinely good idea and cheap to implement.

Shipped gates (`adw_modules/gates.py`, 108 lines total):
- `artifacts_exist` — every declared artifact exists (note carries the size)
- `files_non_empty` — declared artifacts are non-zero
- `json_parses` — declared `.json` artifacts parse
- `diff_matches_claims` — every file in `changed_files` exists on disk
- `verdict_consistent` — **the reviewer's envelope must agree with itself**: no `approved=true` with blocking items, no `approved=true` with unmet findings, and a rejection must name a problem. *"Nothing here judges the code... This checks the envelope against itself: an approval that ships blocking items, or a rejection that names no problem, is a claim the harness can refute without reading a line of the diff."*
- `tests_pass(command)` — a **gate factory**; the shell command must exit 0, failing output tail (1000 chars) becomes the note

### 3.5 Gate retries / attempts

The loop in `agents.execute()`:

```python
for gate_attempt in range(1, max(1, phase.params.retries + 1) + 1):
    violations = []
    for gate in call.gates:
        report = _as_report(gate(envelope, run))
        found = report.violations
        run.tracer.gate_row(phase, gate.__name__, report, gate_attempt)
        run.tracer.event(EventRecord(..., type="gate_fail" if found else "gate_pass",
            name=gate.__name__,
            payload={"attempt": gate_attempt, "violations": found,
                     "checks": [c.model_dump() for c in report.checks]}))
        violations.extend(found)
    if not violations:
        break
    if gate_attempt > phase.params.retries:
        raise GateFailure(...)
    phase.attempt = gate_attempt
    correction = ("Your previous response failed validation:\n- "
                  + "\n- ".join(violations)
                  + "\n\nFix these problems, then re-emit ONLY your Report JSON.")
    result = send(correction)
    envelope, attempt = _parse_with_retries(run, phase, call, result, send)
```

So: **two independent bounded retry budgets** — `JSON_FIX_ATTEMPTS=2` (module constant) for parse failures, and `PhaseParams.retries` (per call site, default 0) for gate violations. Both re-enter the *same* session.

Order of operations in one agent phase:
1. snapshot the working tree (`permissions.snapshot`)
2. render + save prompts, emit `agent_start`
3. send user prompt → pi
4. parse with retries → envelope
5. gate loop with corrections
6. **`permissions.enforce`** — after every send, before the envelope is accepted (*"an agent does not get to report success on a phase in which it wrote somewhere it was not allowed to"*)
7. persist envelope, write `agent_map.json`, emit `handoff` + `agent_end`
8. raise if `envelope.status != "success"`

### 3.6 Cost & token tracking

`UsageBreakdown` mirrors pi's `usage` shape one-for-one:

```python
class UsageBreakdown(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0     # the thinking SHARE of output, NOT a fifth component
    total_tokens: int = 0
    input_cost: float = 0.0
    output_cost: float = 0.0
    cache_read_cost: float = 0.0
    cache_write_cost: float = 0.0
    total_cost: float = 0.0
```

Key modelling decisions, all documented in-code:
- `input` **excludes** cache reads, which bill at their own cheaper rate.
- `reasoning_tokens` is **nested under output**, never added — *"measured across every session on disk, reasoning is always <= output and the four components above always sum to totalTokens."*
- A retried phase pays for **every attempt**: `spent.merge(result.usage)` accumulates across all sends, and `agent_end.tokens` is the phase total, not the last send's.
- **Cost ≠ context.** `events.tokens` and `sessions.total_tokens` bill every turn and only grow; `context_tokens` is *occupancy* after the last valid assistant turn, measured against `context_window` from pi's registry.

> "an agent that burned 100k tokens may be sitting in a 15k window"

The VALUE.md example is the best argument for tracking these separately:

> "A recent planner run billed **509,998 tokens for $0.0683** — and ended holding only **51,166 tokens**, 5% of its window. The gap is prompt caching: 400,154 of those tokens were cache reads at a quarter the input rate. Without them the same run costs roughly 2.3× more."
>
> "Cost, context, and cache are separate numbers because they answer separate questions — *what did this cost*, *is this agent about to compact*, *is my prompt prefix stable enough to stay cached*."

Rollup: `run.add_usage(tokens, cost)` → `tracer.session_add_usage` → `UPDATE sessions SET total_tokens=total_tokens+?, total_cost=total_cost+?`.

### 3.7 Handoff between agents

Three mechanisms, all in code:

1. **`notes_for_next_agent`** — a field on every envelope. The upstream envelope is injected wholesale as `{{previous_envelope}}` into the next agent's `user.md`.
2. **`artifacts`** — paths written into the shared `context_handoff/` dir (one per session, shared by every agent). The planner writes `plan.md`; the reviewer reads it.
3. **`agent_map.json`** — per-agent coding-agent `session_id`, so a later ADW rejoins the same context window instead of starting cold.

```json
{
  "planner": {"session_id": "sssf-a1b2c3d4-planner-9f2e",
              "model": "google/gemini-3.6-flash", "coding_agent": "pi"},
  "builder": {"session_id": "sssf-a1b2c3d4-builder-71ac",
              "model": "google/gemini-3.6-flash", "coding_agent": "pi"}
}
```

Session-id minting: reuse the existing id **only if the model still matches**, else mint `sssf-{adw_id}-{agent}-{rand4}`:

```python
def _agent_session_id(run, agent: AgentConfig) -> str:
    entry = run.agent_map.get(agent.name)
    if entry and entry.get("model") == agent.model:
        return entry["session_id"]           # rejoin the existing context window
    return f"sssf-{run.adw_id}-{agent.name}-{new_id(4)}"
```

---

## 4. How it invokes the coding agent, and isolation

### 4.1 It uses **pi**, not Claude Code

`adw_modules/agent_pi.py` builds this argv:

```python
cmd = [
    PI_PATH, "-p", "--mode", "json",
    "--provider", provider, "--model", model_id,
    "--thinking", request.thinking,
    "--session-id", request.session_id,
    "--session-dir", request.session_dir,
    "--system-prompt", request.system_prompt,
]
if request.tools:
    cmd += ["--tools", ",".join(request.tools)]
for extension in request.extensions:
    cmd += ["-e", extension]
cmd.append(request.prompt)
```

Notes:
- `-p --mode json` = non-interactive, JSONL event stream on stdout.
- `--session-id` is **create-or-continue** — the single property the whole correction-instead-of-restart design rests on.
- `--system-prompt` takes the **compiled text**, passed as an argv value.
- The prompt travels in **argv**, and `stdin=subprocess.DEVNULL` deliberately:
  > "inheriting the parent's means pi sees a non-TTY and can sit forever waiting for piped input that will never arrive or EOF. That failure is silent and total... Observed as a run that sat idle at 0% CPU with an empty raw_output.jsonl."
- `cwd=request.cwd` = `run.repo_root` — agents are spawned at the repo root.
- `env=operator_env()` — the agent inherits the engineer's own shell environment (PATH, toolchains, credentials). Prompts explicitly tell agents to call binaries by bare name.
- Streaming: iterate `process.stdout` line by line, write each to `raw_output.jsonl` and `flush()`, parse JSON, accumulate usage on `message_end` from assistant messages (last assistant message wins for `result.text`), and forward every event to `on_event`.
- `on_spawn(pid)` / `on_exit(pid)` bracket the child so it lands in the `processes` table.

Model resolution goes through `pi --list-models` (cached with `lru_cache`), requiring `provider/model-id`; a bare id that matches multiple providers is a hard validation error. `context_window` is read from `~/.pi/agent/models.json`.

### 4.2 Claude Code is a stub

```python
"""Claude Code interface — STUB in v1. The factory is Pi-only for now.

The config schema accepts `coding_agent: claude_code` so nothing breaks at the
schema level, but selecting it raises until v2 implements this interface
(`claude -p --output-format stream-json --resume <session_id>`).
"""

def run(*args, **kwargs):
    raise NotImplementedError(
        "coding_agent 'claude_code' is not implemented in v1 — SSSF v1 runs the "
        "Pi coding agent only. Set coding_agent: pi (or omit it) in sssf.config.yaml.")
```

`agents.validate()` rejects any required agent whose `coding_agent != "pi"` before anything spawns.

**For your factory**, the porting surface to Claude Code / Agent SDK is small and well-identified:
- `pi -p --mode json` → `claude -p --output-format stream-json --verbose`
- `--session-id <id>` (create-or-continue) → `--resume <session_id>` / `--session-id` **[INFERENCE: the semantics differ — Claude Code's resume is not identical to pi's create-or-continue, so the "correction in the same session" mechanism needs verifying against the SDK]**
- `--system-prompt <text>` → `--append-system-prompt` / `systemPrompt` option
- `--tools a,b,c` → `--allowedTools` / `--disallowedTools`, plus `--permission-mode`
- `-e extension.ts` (pi harness extensions) → MCP servers / Skills / subagents
- the JSONL event stream shapes differ (`message_end`, `tool_execution_start/end`) and `ToolCallTracker` would need rewriting for Claude Code's `stream-json` message types.

**No permission-mode concept exists in SSSF at all** — pi is invoked with a tool allowlist and no approval prompts; safety comes entirely from the after-the-fact `permissions.enforce` rollback. **[INFERENCE]** with Claude Code you'd likely use `--permission-mode acceptEdits` or `bypassPermissions` inside a sandbox and keep the same after-the-fact enforcement as a second layer.

### 4.3 Isolation: **there is none** — this is the biggest gap

Explicitly stated in the README:

> "Also missing on purpose, so you know what to add: this runs on your current branch. For real work you want a branch per run, a sandbox around the agent, and a merge step at the end."

And again:

> "And what it deliberately does not do. It runs on your current branch. There is no sandbox, no branch per run, no merge step, no cloud, and no human-in-the-loop approval phase. Those are the obvious next things to build."

What exists instead:
- `protected_files` — the agent cannot edit the machinery that grades it.
- `writes` allowlists enforced by working-tree change-set diffing after every call, with rollback.
- `git_helper.commit_all(message)` in `kind="code"` commit phases.

So concurrency is unsafe by construction: two runs in the same repo share one working tree, and `permissions.snapshot()` would see the other run's changes. **[INFERENCE]** for your factory, per-ticket git worktrees are the natural fix and would also make `permissions.snapshot` accurate again.

### 4.4 Harness engineering (pi extensions)

`harness_engineering:` lists TypeScript files loaded into pi with `-e`. Shipped: `subagents.ts` (593 lines — registers `subagent_create` / `_continue` / `_list` / `_remove`) and `themeMap.ts`. Only `planner` and `scout` get them.

A sharp documented edge: `--tools` filters extension tools too, so **an agent whose extension registers a tool MUST also name that tool in its own `tools:` list** or the extension loads and its tool is silently filtered out.

---

## 4.5 The operator layer (how a human drives it)

Worth capturing because it is effectively the "ticket intake" SSSF has instead of a ticket system.

`just cc` / `just pi` / `just ipi` boot a coding agent **on** the factory:
```
cc:
    claude --dangerously-skip-permissions "Read and Execute .claude/skills/sssf/SKILL.md"
```
So Claude Code *is* used — as the **orchestrator**, not as the worker. The orchestrator's posture is strict (`cookbooks/run_adw.md`):

> "The ADW is the worker. Your job is to launch it, watch the trace, and tell the engineer what happened. Do not read the agent's target files and 'help', do not fix the code an agent was supposed to fix, do not edit an envelope."

> "You operate only on the **agentic layer**, the ADWs, the software factory." — `how_to_prompt_for_the_eng.md`

**The four-line prompt shape** (`cookbooks/how_to_prompt_for_the_eng.md`) is the closest thing SSSF has to a ticket template, and it is directly stealable for your ticket system:

```
<the ask — one imperative sentence, their words where they were specific>
Where: <files or dirs you verified>
Done means: <the observable result — a response shape, a passing test, a rendered element>
Out of scope: <what you were tempted to add, named so nobody adds it>
```

With the governing rule: **"The intent is theirs. The precision is yours."** The orchestrator may carry constraints forward verbatim, fix grammar, order steps — but may not drop a requirement, soften a strong ask, or write the plan (that's the planner's job).

Also: longer requests are written to `requests/<slug>.md` and the path is passed to the ADW. The `example` branch has a real `requests/` directory (`split-view-editor.md`, `light-mode-theming.md`, …). **That is the de-facto ticket store: a markdown file per request.**

Chain selection heuristic (also stealable): *"The more complex the ask, the more complete the chain... When two chains both fit, take the longer one — a phase you did not need costs cents, while a change nobody planned, verified, reviewed, or wrote up costs an afternoon."* And: *"Never a single-agent chain when the engineer asked for work to be done."*

**Rosters** are swappable model tiers: `sssf.config.yaml` (Gemini 3.6 Flash across the board — iteration speed, cost floor) vs `sssf.frontier.config.yaml` (Opus 5 plans, Kimi K3 builds, GPT-5.6 Sol scouts). Same scripts, same prompts, same gates, same trace — *"That flag is the entire migration."* And because both land in the same trace DB, *"you can put a frontier run and a budget run side by side and compare what the extra spend actually bought."*

Caveat documented: switching rosters mid-session breaks resumption, because `agent_map.json` records the model each session was created with.

---

## 4.6 The visualizer in detail (verified against source)

Stack: Vue 3.5 `<script setup>` + Vite 7 + Bun HTTP server + `bun:sqlite`. ~4,300 lines. Runtime deps: only `vue`, `lucide-vue-next`, `@fontsource/play`. **No state library, no router library, no markdown or highlighting library — all hand-rolled.**

`server/db.ts` contains **no** `CREATE TABLE` — it is a pure reader. The schema is owned by the Python tracer (§2.5).

### Ports — resolved definitively

| | Port | Source |
|---|---|---|
| **Bun API server** | **4600** | `server/index.ts` — `const PORT = Number(process.env.PORT ?? 4600)` |
| **Vite dev server (the UI you browse)** | **4601** | `vite.config.ts` — `server: { port: 4601 }`, **hardcoded, not env-configurable** |

So **your `localhost:4601` was right for dev.** The client uses bare same-origin relative paths (`fetch('/api/sessions')`) — no base URL constant, no `VITE_API_URL`. Two modes make that work:
1. **Dev:** Vite proxies `/api` → `http://localhost:${process.env.PORT ?? 4600}`. You browse `:4601`.
2. **Built:** `bun run build` emits `./dist` and the Bun server on `:4600` serves the SPA itself (with `index.html` fallback for hash routes). Then there is no 4601 at all.

The README's *"Vue and Vite served by Bun on port 4600"* is true only for built mode; the `justfile` comment gets it right: `# boot the trace UI, http://localhost:4601 (api on :4600)`.

### HTTP API (complete)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ok, db, journal_mode, sessions}` — **exported in `api.ts` but never called by the UI** |
| GET | `/api/sessions?limit=200` | `SessionSummary[]` with `phases[]` and `agents[]` embedded; `archived=0` only |
| GET | `/api/sessions/:adw_id` | `{session, usage:{read,written}, phases[], agents[]}` |
| POST | `/api/sessions/:adw_id/archive` | `{archived?: boolean}` → the **only write in the process** |
| GET | `/api/sessions/:adw_id/events?after=<rowid>&limit=500` | `{events, cursor, has_more}` |
| GET | `/api/sessions/:adw_id/envelopes` | `Envelope[]` |
| GET | `/api/sessions/:adw_id/gates` | `GateResult[]` |
| GET | `/api/sessions/:adw_id/agents/:agent/prompts` | `{system: string\|null, user: string\|null}` — **reads the saved prompt files off disk** |
| — | else | static `./dist` with SPA fallback |

Path-traversal defense is two-layered: `SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/` plus a `dir.startsWith(sessionsDir + sep)` prefix check.

DB resolution: `--db <path>` → `--db=<path>` → `SSSF_DB` → `adws/adw_data/sssf.db`. Missing file → helpful message + `process.exit(1)`.

### Polling: 500ms, three independent pollers

| Component | Polls | Condition |
|---|---|---|
| `SessionsList.vue` | `GET /api/sessions` — **full refetch, no cursor** | always while mounted |
| `SessionCard.vue` | events with rowid cursor | **only while `status === 'running'`** — stops itself on transition |
| `SessionTrace.vue` | session detail + events (cursor) + conditionally envelopes/gates | always while mounted |

Each guards with an `inflight` boolean so a slow response can't stack requests. Verbatim server query:

```sql
SELECT rowid, event_id, adw_id, phase_id, parent_id, type, name,
       payload_json, tokens, started_at, ended_at
  FROM events
 WHERE adw_id = ? AND rowid > ?
 ORDER BY rowid
 LIMIT ?
```

The client drains fully each tick (loops while `has_more`).

**Side-table throttling** — a nice touch worth stealing. Envelopes and gates are only refetched on first load or when a boundary-ish event arrives:

```ts
const SIDE_TABLE_TYPES = new Set(['gate_pass', 'gate_fail', 'handoff', 'agent_end', 'phase_end', 'error'])
if (!loaded.value || fresh.some((e) => e.type !== null && SIDE_TABLE_TYPES.has(e.type))) {
  const [env, g] = await Promise.all([fetchEnvelopes(props.adwId), fetchGates(props.adwId)])
```

Confirmed by grep across the whole app: **no WebSocket, no SSE, no EventSource, no ingest endpoint.**

### Event type union (verbatim, `shared/types.ts`)

```ts
/** events.type — the ten types tracer.py emits. */
export type EventType =
  | "phase_start"
  | "phase_end"
  | "agent_start"
  | "agent_end"
  | "tool_call"
  | "handoff"
  | "gate_pass"
  | "gate_fail"
  | "log"
  | "error"
```

Dot colors used on session-card timelines (`src/lib/events.ts`):

```ts
export const EVENT_DOT_COLORS: Record<string, string> = {
  agent_start: '#c89bff',
  tool_call:   '#5ad2dd',
  handoff:     '#94a3ff',
  agent_end:   '#4ade80',
  error:       '#ff6f67',
  gate_fail:   '#ff6f67',
}
```

**Only 6 of 10 types get dots** — `phase_start`, `phase_end`, `gate_pass`, `log` are silently dropped from card timelines (so phase boundaries don't appear on the L1 card at all). The `PhaseDetail` text-color map is a *different, larger* map and the two disagree on `gate_pass`. There is **no legend anywhere**.

### The swim-lane waterfall (`SessionTrace.vue`)

**Lanes are not just `kind`:**
1. **One `engineer` lane, always** — label = `session.engineer`, color hardcoded `#e8b64a`, icon `UserRound`
2. **One `code` lane, only if `kind === 'code'` phases exist** — label `"code"`, meta `"workspace"`, color `#5ad2dd`, icon `SquareTerminal`
3. **One lane per distinct `phases.owner` among agent phases**, in first-appearance order, icon `Bot`

So lanes = kind for engineer/code, **but owner for agents**. Agent lane color resolves `configColor ?? payloadColor ?? AGENT_FALLBACK_COLORS[i % 5] ?? '#c89bff'` — where `payloadColor` comes from the live `agent_start` event, so a *running* agent gets its correct color before its `agent_sessions` row is ever written.

Lane label column is a fixed **280px** (`grid-template-columns: 280px 1fr`) showing name + kind icon, model name + provider icon (contains-match on the model string → `/models/{claude,gemini,kimi,openai,zai}.png`), and the **context-window bar**:

```ts
function laneContext(info: AgentSession | undefined): LaneContext | null {
  const used = info?.context_tokens ?? 0
  const window = info?.context_window ?? 0
  if (!used || !window) return null
  return { used, window, pct: Math.min(100, (used / window) * 100) }
}
```
Null unless *both* numbers are real — *"a bar against an unknown ceiling would be decoration, not data."* Fill floored at 2% width so non-zero is always visible.

**Time axis.** `range` spans session start/end plus every phase start/end, extended to `nowMs` if running, 1000ms minimum. The engineer's request phase gets an **exclusive leading 16% zone** (`REQ_ZONE_PCT = 16`) rendered as a labelled band. `originMs` is the earliest *non-engineer* phase start — deliberately not the request's `ended_at`, because a chained ADW pushes that forward and would throw finished phases behind the origin. Ticks snap to a step from `[1,2,5,10,15,30,60,120,300,600,1200,1800,3600]` seconds; labels `0s, 30s, 1m, 1m30s, 1h05m`.

**Block layout — the interesting algorithm.** Raw `left`/`width` in track-%, then a minimum-width-with-cascading-shift pass:

```ts
const MIN_BLOCK_PCT = 3.5
let shift = 0, prevEdge = 0
for (const b of timed) {
  let left = b.left + shift
  if (left < prevEdge) { shift += prevEdge - left; left = prevEdge }
  const width = Math.max(b.width, MIN_BLOCK_PCT)
  shift += width - b.width
  prevEdge = left + width
  rows.push({ id: b.id, left, width })
}
const scale = avail / Math.max(prevEdge, avail)
```

A near-instant git commit widens to 3.5% and everything later shifts right, then the layout normalizes back into the track. Doctrine: *"Blocks may squeeze a hair; they never stack."*

> **Critical caveat for your design:** this loop iterates all lanes at once, sharing one `shift`/`prevEdge`, so it enforces a **single global sequential ordering**. If two agents ever run genuinely in parallel, the layout serializes them and x-positions stop matching the axis. The code says "phases are sequential by doctrine" — but the render silently lies rather than showing overlap. **Parallel phases are an obvious next step for a real factory, so this algorithm does not survive that change.**

Each block renders a duration `StatChip` (e.g. `1m 04s`), status glyph (`✓ ✗ ● ○`), name and description, at fixed 92px height in a 118px track, background a vertical gradient of the lane color 20%→5%. Every `tool_call` in the phase becomes a **3×9px tick** at the block's bottom, positioned within the block's own span, red if the call failed. **Queued phases** bypass geometry and are pinned to the right edge as dashed 170px ghosts cascaded 5px apart. A running phase's end is `nowMs`, so live blocks grow every 500ms.

### PhaseDetail — where "22 lines"/"56 lines" comes from

Two-column grid: left = collapsible sections, right = event stream. Header shows phase name, `StatusChip`, runtime, and pill tags for `owner`, `kind`, and `attempt` rendered as **`{attempt}/{retries}`**.

Prompts come from `GET /api/sessions/:adw_id/agents/:agent/prompts`, which reads the audit copies off disk. The line count is literally a newline split:

```ts
panels.push({ id, title, text, html: renderMarkdown(text), lines: text.split('\n').length })
```

rendered as:

```html
<button class="prompt-head" @click="togglePanel(panel.id)">
  <span class="chev">{{ openPanels.has(panel.id) ? '▾' : '▸' }}</span>
  <span class="prompt-title">{{ panel.title }}</span>
  <span class="dim">{{ panel.lines }} lines</span>
</button>
```

So "22 lines" = `text.split('\n').length` — note a trailing newline inflates it by one. Each of system/user is independently collapsible with a **rendered / raw toggle** (rendered runs hand-rolled markdown; raw shows a `<pre>` of the exact text sent). `max-height: 60vh` scroll, cached in a module-level `Map` keyed `${adwId}:${owner}`.

**Poll-resilience** is handled deliberately: watchers key on the stable `phase_id` / `[adw_id, owner, kind]` strings rather than the phase object, because the 500ms poll replaces the object every tick and would otherwise *"snap [panels] shut twice a second."* Every section starts **closed** (`DEFAULT_OPEN_SECTIONS = []`).

Left-column sections: **request** (engineer phase's `log` event with `input`), **agent config** (coding agent, model + provider icon, thinking level, tool chips or "all tools" when `null`, harness extensions, purpose, session id), **description**, **compiled prompts**, **gates**, **cost**, **outputs** (one block per envelope: `output_type`, agent, attempt, **`valid`/`invalid` badge**, full pretty-printed payload). That badge is your `"PlanOutput ... valid"` line.

**Gates** sort by attempt then id, expandable, showing each `{item, ok, note}`; a multi-line note (e.g. `tests_pass`'s command output tail) gets its own `<pre>`. `"[]"` is explicitly distinguished from `null` — *"nothing to check"* vs *"no evidence recorded"*.

**Cost table** built from `agent_end.usage`:

```ts
const rows: UsageRow[] = [
  { label: 'input',  tokens: u.input_tokens,  cost: u.input_cost },
  { label: 'output', tokens: u.output_tokens, cost: u.output_cost },
]
if (u.reasoning_tokens) {
  const share = u.output_tokens ? (u.output_cost * u.reasoning_tokens) / u.output_tokens : 0
  rows.push({ label: 'thinking', tokens: u.reasoning_tokens, cost: share, kind: 'nested',
    title: 'Thinking tokens — part of output above, billed at the output rate. Not added to the total.' })
}
rows.push(
  { label: 'cache read',  tokens: u.cache_read_tokens,  cost: u.cache_read_cost },
  { label: 'cache write', tokens: u.cache_write_tokens, cost: u.cache_write_cost },
  { label: 'total', tokens: u.total_tokens, cost: u.total_cost, kind: 'total' })
```

`thinking` is **indented under output and excluded from the sum**. `money()` shows 4 decimals, `<$0.0001` below that. Runs predating the breakdown show a single total plus *"this run predates the per-component breakdown"* — **never fabricated zeroes**.

Session run-strip chips: cost, runtime, tokens (billed), read, written.

### Forward/backward schema compat — the sharpest bit of engineering here

A readonly connection cannot run the tracer's `ALTER`s, so selecting a migrated column would throw "no such column" against an older DB. `optionalColumn()` probes `PRAGMA table_info` and substitutes `NULL AS column` — **and re-runs the probe while the column is missing, latching once found**, because the tracer's ALTER can land mid-serve. A startup-only check would return NULL forever after the data arrived.

### Weaknesses of the visualizer (relevant to your build)

- **No indexes** — `events` has no index on `adw_id`. The poll query walks the rowid btree from the cursor filtering row-by-row: fine for a live tail near the end, but a cold load of an *old* session scans every event row after its first. `CREATE INDEX ... ON events(adw_id, rowid)` fixes it.
- **`SessionsList` refetches ALL sessions every 500ms** with phases and agents embedded, unbounded but for `limit=200`, while every running card independently polls too. 20 concurrent runs = 21 requests / 500ms. The events endpoint is beautifully incremental; the sessions endpoint is not incremental at all. No ETag, no If-Modified-Since.
- **Unbounded client memory** — `events.value = [...events.value, ...fresh]` never trims and reallocates the whole array each tick; each card holds its own full history; no virtualization on the event list.
- **No filtering or search anywhere** — no event-type filter, no text search, no session filter by status/engineer/date, no sort. For a tool whose purpose is finding what went wrong in a long run, "scroll and read" is the only affordance.
- **No zoom/pan/brush**, and `.track` is `overflow: hidden` so anything normalization can't fit is clipped. A 3-hour run compresses into the same fixed track as a 30-second one.
- **The `processes` table is entirely unsurfaced in the UI** — the one place you'd look at a hung run doesn't read the table that exists precisely for hung runs.
- **Archive is one-way in the UI** — the API accepts `archived: false` but nothing calls it that way and `db.sessions()` hard-filters `archived = 0`. No undo, no "show archived", no confirmation.
- No responsive design, no accessibility pass (fixed 280px lanes, `title`-only tooltips, no `aria-live`, color-plus-glyph status).

---

## 5. claude-code-hooks-multi-agent-observability

A **different and much shallower** system than SSSF: a generic Claude Code hook event firehose with a real-time viewer. No phases, no gates, no cost.

### 5.1 The pipeline

From the README:
```
Claude Agents → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue Client
```

1. Claude Code fires a lifecycle hook, piping hook JSON to each configured command's stdin.
2. Each hook event runs **two** commands in sequence: a local logger/validator script, then `send_event.py`.
3. `send_event.py` reads stdin, extracts the model from the transcript, optionally attaches the full chat transcript and/or an AI summary, and POSTs to `http://localhost:4000/events` (5s timeout). It **always** `sys.exit(0)`.
4. The Bun server validates 4 required fields, inserts into SQLite, then broadcasts `{type:'event', data: savedEvent}` to every WebSocket client.
5. The Vue client appends to a reactive array capped at 300 events.

`.claude/settings.json` wires **12 hook events**, each as a pair. Representative entries (verbatim):

```json
"PreToolUse": [{ "matcher": "", "hooks": [
  { "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/pre_tool_use.py" },
  { "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app cc-hook-multi-agent-obvs --event-type PreToolUse --summarize" }
]}],
"Stop": [{ "hooks": [
  { "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/stop.py --chat" },
  { "type": "command", "command": "uv run $CLAUDE_PROJECT_DIR/.claude/hooks/send_event.py --source-app cc-hook-multi-agent-obvs --event-type Stop --add-chat" }
]}]
```

Flag distribution: `--summarize` on PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, UserPromptSubmit. `--add-chat` only on Stop. Nothing on SubagentStart/Stop, SessionStart/End, PreCompact. The settings also set `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` and `"teammateMode": "in-process"`.

### 5.2 The event payload (verbatim from `send_event.py`)

```python
    event_data = {
        'source_app': args.source_app,
        'session_id': session_id,
        'hook_event_type': args.event_type,
        'payload': input_data,
        'timestamp': int(datetime.now().timestamp() * 1000),
        'model_name': model_name
    }
```

Plus conditional top-level promotion of `tool_name`, `tool_use_id`, `error`, `is_interrupt`, `permission_suggestions`, `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `notification_type`, `custom_instructions`, `source`, `reason` — then `event_data['chat']` (full transcript parsed to a JSON array) when `--add-chat`, and `event_data['summary']` when `--summarize`.

POST:
```python
def send_event_to_server(event_data, server_url='http://localhost:4000/events'):
    req = urllib.request.Request(server_url,
        data=json.dumps(event_data).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Claude-Code-Hook/1.0'})
    with urllib.request.urlopen(req, timeout=5) as response:
```

**Latent bug worth knowing:** the ~12 promoted top-level fields are **never persisted** — `insertEvent()` writes only 10 named columns. They survive only on the live WebSocket broadcast. After a reload, they're gone. Nothing consumes them today (`EventRow.vue` reads `event.payload.tool_name`, not `event.tool_name`), which is the only reason it hasn't bitten.

### 5.3 SQLite schema (verbatim, `apps/server/src/db.ts`)

DB file `events.db`, `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`.

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL,
  session_id TEXT NOT NULL,
  hook_event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  chat TEXT,
  summary TEXT,
  timestamp INTEGER NOT NULL
)
```
Plus runtime `ALTER TABLE` migrations adding `chat`, `summary`, `humanInTheLoop`, `humanInTheLoopStatus`, `model_name` (all TEXT). Insert:
```sql
INSERT INTO events (source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Unlike SSSF, this one does have indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_source_app ON events(source_app)
CREATE INDEX IF NOT EXISTS idx_session_id ON events(session_id)
CREATE INDEX IF NOT EXISTS idx_hook_event_type ON events(hook_event_type)
CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)
```

There are also `themes`, `theme_shares`, `theme_ratings` tables — a full theme marketplace bolted into the same repo (~1/3 of the server surface). `theme_shares` and `theme_ratings` are **created and never written to** — dead schema.

### 5.4 Routes and WebSocket

Port `SERVER_PORT || 4000`. CORS wide open (`Access-Control-Allow-Origin: *`).

Key routes: `POST /events`, `GET /events/filter-options`, `GET /events/recent?limit=300`, `POST /events/:id/respond` (HITL), plus 8 `/api/themes*` routes and `/stream` (WebSocket upgrade). **There is no `/health` route** despite `start-system.sh` and `just health` curling it — they succeed only because the catch-all returns 200. Two route-order bugs: `/api/themes/stats` and `/api/themes/:id/export` are shadowed by an earlier `startsWith('/api/themes/')` GET branch.

Only **two** WebSocket message shapes are ever sent:
```ts
ws.send(JSON.stringify({ type: 'initial', data: getRecentEvents(300) }));   // on connect
const message = JSON.stringify({ type: 'event', data: savedEvent });        // on POST /events
```
The client type declares a third (`hitl_response`) the server never emits.

Client cap (`useWebSocket.ts`):
```ts
const maxEvents = parseInt(import.meta.env.VITE_MAX_EVENTS_TO_DISPLAY || '300');
if (message.type === 'initial') { events.value = initialEvents.slice(-maxEvents); }
else if (message.type === 'event') {
  events.value.push(newEvent);
  if (events.value.length > maxEvents) events.value = events.value.slice(events.value.length - maxEvents + 10);
}
```
Reconnect is a fixed 3s retry, no backoff. **No server-side cap, TTL, or pruning** — no `DELETE FROM events`, no `VACUUM`, no retention logic. `events.db` grows forever, and `Stop` events embed **entire parsed transcripts** in the `chat` column. The only remedy shipped is `just db-reset` (delete the file).

### 5.5 The 12 hook types

`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`.

Notable: `pre_tool_use.py` is the only real blocking logic:
```python
def deny_tool(reason):
    output = {"hookSpecificOutput": {"hookEventName": "PreToolUse",
              "permissionDecision": "deny", "permissionDecisionReason": reason}}
    print(json.dumps(output)); sys.exit(0)
```
It blocks dangerous `rm -rf` unless paths are under `ALLOWED_RM_DIRECTORIES = ['trees/']`. The `.env` file-access block exists but is **commented out** in `main()`.

`user_prompt_submit.py --name-agent` generates a one-word agent name via an LLM and stores prompt history in `.claude/data/sessions/{session_id}.json`.

### 5.6 The UI

**It is not a true swim-lane.** The main view is a single reverse-chronological vertical list (`EventTimeline`) with slide-in animations. Swim lanes are **opt-in**: clicking an agent tag adds an `AgentSwimLane` — a per-agent 80px mini canvas chart with model badge, event count, tool-call count, avg gap.

**Dual-identity color scheme** (genuinely good): each row has a 3px **app** color bar at `left-0` and a 1.5px **session** gradient bar at `left-3`. Agent identity is `source_app:session_id[0:8]`. Sessions map onto a 10-entry Tailwind palette; apps use continuous HSL `hsl(${hash % 360}, 70%, 50%)` — so app colors never collide, but **session colors collide past ~10 concurrent sessions**.

**Combo emojis**: event-type emoji + tool emoji (`🔧💻` = PreToolUse:Bash), 24 tool emojis including team tools, `mcp__*` → 🔌.

**Filters**: three server-backed single-select dropdowns (Source App, Session ID, Event Type), AND-combined, re-polled every 10s; plus a client-side **regex search box**. *(Caveat: `useEventSearch.ts` reads fields that don't exist on `HookEvent` — `event.model`, `event.tool_name`, `event.tool_command` — so regex search silently matches far less text than intended.)*

**Live pulse chart**: canvas, DPR-aware, 96px tall, fixed 30 FPS. Ranges 1m/3m/5m/10m with 60 buckets. Bars colored by the **dominant session** in each bucket, with emoji labels for the top-3 tool combos. *(Internal retention is 5 minutes, so the 10m range silently under-reports.)*

**Themes**: 12 predefined + a custom theme manager persisted to localStorage, backed by the server-side theme CRUD/share/rate API.

### 5.7 Human-in-the-loop: **a library, not a wired feature**

This is the most important finding for your design, because HITL is something you want.

`utils/hitl.py` is imported **only** by `test_hitl.py` and `examples/hitl_example.py`. **No entry in `settings.json` uses it.** It cannot block a tool call today.

The mechanism (from `app_docs/how_human_in_the_loop_v1_works.md`) is genuinely clever — **the agent inverts the direction**: it stands up its *own* WebSocket server on an OS-assigned free port, POSTs the URL to the observability server, and blocks on `Thread.join(timeout)`:

```python
    def get_hitl_data(self) -> Dict[str, Any]:
        return {
            "question": self.question,
            "responseWebSocketUrl": f"ws://localhost:{self.response_port}",
            "type": self.hitl_type,      # question | permission | choice
            "choices": self.choices,
            "timeout": self.timeout,
            "requiresResponse": True
        }
```

Server stamps `humanInTheLoopStatus = {status: 'pending'}` and broadcasts. `EventRow.vue` replaces the normal row with a pulsing yellow card rendering one of three widgets by type: textarea (`question`), Approve/Deny (`permission`), one button per choice (`choice`). Submitting POSTs to `/events/:id/respond`; the server then opens a client WebSocket back to the agent's random port, sends the response, waits 500ms, closes.

Convenience API: `ask_question() -> str|None`, `ask_permission() -> bool`, `ask_choice() -> str|None`, default `timeout=300`.

Undelivered pieces: `timeout`/`error` statuses are declared but never set — **nothing expires a pending request server-side**. `useHITLNotifications.ts` exists but is imported nowhere. `hitl.py` needs `websockets` and `requests`, neither declared in a PEP-723 block. The doc itself says: *"**No authentication** (local trust model). Suitable for development, not production."*

### 5.8 Model attribution and cost

`utils/model_extractor.py` reads the transcript `.jsonl` **backwards** for the first assistant message with `message.model`. It rides as `model_name`, persists in that column, and the UI shows a 🧠 badge (`claude-haiku-4-5-20251001` → `haiku-4-5`).

Two real code/doc discrepancies found:
1. The doc says the cache is project-local at `.claude/data/claude-model-cache/`; the code uses `Path.home() / ".claude" / "data" / "claude-model-cache"` — **global**.
2. The doc's entire premise is a 60s TTL cache ("50-100x performance improvement") — but the shipped code has `ENABLE_CACHING = False`. So **every hook event does a full `readlines()` of the whole transcript**, synchronously in the hook path, on ~12 event types.

**Cost is not tracked at all.** No token counts, no dollar figures, no `usage` capture in the server or event schema. The only hit is `ChatTranscript.vue` displaying `usage.input_tokens/output_tokens` when the raw transcript JSON happens to contain it — display of embedded data, not aggregation.

Meanwhile the system *spends* money it doesn't measure: `--summarize` calls `claude-haiku-4-5` synchronously on **every** PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification and UserPromptSubmit event.

### 5.9 What's good / bad about the observability repo

**Good:**
- **The universal-sender pattern.** One `send_event.py` parameterized by `--source-app`/`--event-type` means adding an event type is a config line, not code. Copy `.claude/` anywhere, change one string. This is why the repo gets copied around.
- **Fail-open discipline, applied consistently.** Every hook ends with a bare `except: sys.exit(0)`; `send_event.py` unconditionally exits 0; the POST has a 5s timeout. **Observability can never wedge the agent.**
- **Two commands per hook** (local logger/validator, then generic emitter) keeps concerns separate.
- **Dual-identity coloring** (`source_app:session_id[0:8]`, app color + session color as two stripes) is a good visual answer to "which of my 8 parallel agents did this."
- **Combo emojis** carry tool identity into a 3px canvas bar — readable tool mix without a legend.
- **HITL's inverted WebSocket** sidesteps any need for the server to know how to reach the agent.
- Bun + `bun:sqlite` + WAL + a near-zero-dependency client makes it trivially runnable.

**Bad / missing:**
- **No cost or token accounting whatsoever** — the single most valuable aggregate is absent.
- **No durations.** `PreToolUse` and `PostToolUse` both carry `tool_use_id`, so pairing them into a per-tool latency is a five-line join — and it isn't done. There is no notion of how long anything took.
- **No phases, no gates, no run/task model.** A flat event stream. Nothing can gate on state. Task/TaskCreate/TeamCreate are logged as generic tool calls with no lifecycle reconstruction.
- **HITL is unwired** — a demo, not a mechanism.
- **No retention, ever** — unbounded DB growth with entire transcripts embedded.
- **No multi-user, no auth, no isolation.** CORS `*`, no tokens, no user model, `authorId` as an unauthenticated query param.
- Scale ceilings: 300-event window everywhere; session colors collide past 10 sessions; pulse chart discards >5min while offering a 10m range.
- Scope creep: a full theme marketplace inside an agent-observability tool.

**Bottom line:** an excellent, highly copyable *event transport* attached to a beautiful but shallow real-time viewer. It answers *"what is happening right now, and which agent did it"* very well. It cannot answer *"what did that cost," "how long did it take," "where is this run in its plan,"* or *"let me stop it before it does that."*

---

## 6. What's clever and worth stealing / what's missing for a real factory

### 6.1 Steal these (ranked by value to your design)

**1. Code owns the loop; agents are bounded nodes.**
The whole thesis. A Python (or TypeScript) script with an explicit phase list, not an agent deciding what runs next. *"This is the difference between code that calls agents and an agent that calls your code. The first is a program you can read, diff, test, and pin to a commit. The second is a system whose behavior you infer."* (VALUE.md)

**2. The typed envelope + gate + correction loop.**
- Every agent call declares a concrete Pydantic output type.
- Parse failure → re-prompt the **same session** with a correction naming the required fields (bounded, 2 attempts).
- Gates verify the envelope's **claims after the fact**, never predictions.
- Gate violations → correction in the same session, bounded by `PhaseParams.retries`.
- **Nothing ever cold-restarts.** *"A cold restart throws away everything the agent learned. A correction costs one message."*

**3. Gates that record evidence, not just a verdict.**
`GateReport.check(item, ok, note)` — one check per thing examined, with the note as evidence (`"exists, 2.1KB"`, `"exit 0"`). A green gate can answer *what did you verify*. Cheap to implement, enormously better for debugging than a boolean. `checks_json` and `violations_json` both persist.

**4. `verdict_consistent` — validate the reviewer against itself.**
An `approved=true` that ships blocking items, or a rejection that names no problem, is *"a claim the harness can refute without reading a line of the diff."* Directly applicable to your multi-lens reviewer.

**5. `tools` (capability) vs `writes` (boundary), enforced by change-set diffing.**
A tool allowlist is a statement of intent nothing checks, because `bash` runs anything and `write` reaches any path. Snapshot the working tree before the call, diff after, roll back unauthorized changes, fail the phase. `protected_files` means **no agent can edit the machinery that grades it**. This is the single most transferable safety idea in either repo.

**6. Save the compiled prompt to disk *before* execution.**
`prompts.save(...)` writes the exact `system.md` + `user.md` sent, as "the audit copy," which the UI then serves and line-counts. Trivial to implement, and it's the difference between "here's the template" and "here's what was actually sent."

**7. Cost, context, and cache as three separate numbers.**
- `total_tokens` = billed volume, only grows, sums across retries
- `context_tokens` / `context_window` = *occupancy* after the last valid assistant turn
- `cache_read` billed separately from `input`
- `reasoning_tokens` nested **under** output, never added

The 509,998-tokens-for-$0.0683-while-holding-51,166 example is the argument. Answers three different questions: *what did this cost*, *is this agent about to compact*, *is my prompt prefix stable enough to stay cached*.

**8. Two acceptance questions: phases passed ≠ run accepted.**
`run.finish(accepted=..., reason=...)` settles DB status, banner, and exit code in one call so they cannot disagree. Written after a real bug where a red suite was recorded green everywhere while exiting 1.

**9. The `processes` table.**
`adw_id → pid + command`, `ended_at NULL = alive`. *"A hung agent emits nothing, which is exactly when you need its pid."* Plus: verify the recorded command still matches the pid before killing (pids get recycled), and turn SIGTERM/SIGINT into `SystemExit` so a killed run finalizes its own trace instead of reading `running` forever.

**10. Adapters: deterministic results shaped as envelopes.**
`quality.as_envelope(result)` → `VerifyOutput`; `changes.as_envelope(changeset)` → `ChangesOutput`. *"The consuming agent cannot tell the difference, which is the point."* A failing test run reaches the builder through the same door an agent's report would. Lets you replace an agent with code without touching the repair loop.

**11. "A known command is code, not an agent."**
No tester agent. *"An agent rediscovering your test runner burns a context window to learn what a subprocess already knows... Worse, it puts a passing test suite into a context window, which buys you nothing at all."*

**12. Required, non-echo phase descriptions, validated at construction.**
The only intent string the trace/console/UI ever shows. Rejecting `commit_plan: "Commit the plan"` at construction time is design pressure that pays off in every trace you read later.

**13. The polling-over-push transport.**
One rowid-cursor query is the entire data path: `WHERE adw_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`. Live tail and full history are the same query at different cadence — no ingest endpoint, no WebSocket, no backfill, no dedup, **no separate replay path**. WAL + readonly reader means the UI can never block or corrupt a running agent. For a local-first single-operator system this is a lot of complexity correctly refused.

**14. Files are the raw record; the DB is the queryable mirror.**
*"Losing the db loses nothing you cannot rebuild."* Both are written; the DB is disposable/rebuildable.

**15. The four-line request shape.**
`<ask> / Where: / Done means: / Out of scope:` with *"The intent is theirs. The precision is yours."* This is your **ticket template**, and `requests/<slug>.md` is SSSF's de-facto ticket store.

**16. Rosters as swappable model tiers.**
`sssf.config.yaml` vs `sssf.frontier.config.yaml`, selected by one `--config` flag. Same scripts, prompts, gates, trace. Both land in the same trace DB so you can compare what the extra spend bought.

**17. Fail-open observability** (from the obs repo). Hooks always `exit(0)`, POSTs time out at 5s. Instrumentation must never be able to wedge the work.

**18. The universal event sender** (from the obs repo). One emitter parameterized by `--source-app` / `--event-type`; adding an event type is a config line, not code.

**19. Side-table refetch throttling.** Only refetch envelopes/gates when a boundary event (`gate_*`, `handoff`, `agent_end`, `phase_end`, `error`) arrives, not every tick.

**20. Poll-resilient UI state.** Key watchers on stable ID strings, not on the polled object, or the UI resets the user's expanded sections twice a second.

**21. `optionalColumn()` schema compat.** A readonly reader probes `PRAGMA table_info` and substitutes `NULL AS col` for columns a newer writer may not have added yet — **re-probing while missing and latching once found**, because the ALTER can land mid-serve.

**22. Degradation messages instead of fabricated zeroes.** *"this run predates the per-component breakdown — only the total was recorded."* Distinguish `[]` ("checked nothing") from `null` ("no evidence recorded").

### 6.2 Gaps you must fill (SSSF explicitly does not do these)

**1. No ticket system at all.** SSSF has `requests/<slug>.md` files and an `adw_id`. There are no Projects, no Tickets, no Designs, no statuses driving work, no backlog, no relationships. **This is your entire layer 1** and there is nothing to borrow but the four-line request shape and the `specs/<adw_id>_<slug>.md` naming convention.
- Note the planner prompt has to do explicit filename-collision avoidance (`_v2`, `_v3`) because there's no ID authority. A real ticket system makes that a foreign key.

**2. No isolation — runs on your current branch.** No worktrees, no branches, no sandbox, no merge step. Stated three times in the README as deliberate. Consequences:
- **Concurrent runs in one repo are unsafe by construction** — `permissions.snapshot()` would see the other run's changes and attribute them to the wrong agent.
- **[INFERENCE]** per-ticket `git worktree` is the natural fix, and it also makes `permissions.snapshot` accurate again. Claude Code's `isolation: "worktree"` for subagents is the same idea.

**3. No human-in-the-loop approval phase.** SSSF has none. The obs repo has a clever design for one (inverted WebSocket, three widget types) that is **not wired to anything**. You want an `approval` phase kind alongside `engineer`/`agent`/`code`, and a durable pending state — note the obs HITL never expires a pending request server-side.

**4. No resumability of a failed run.** `--adw-id` joins a session and resumes each agent's context window, but there is no "resume from phase N" — a re-run re-executes the chain from the top. Phase records exist and are addressable, so **[INFERENCE]** checkpoint/resume is a natural extension of the existing model.

**5. No parallelism.** Everything is strictly sequential, and the waterfall layout algorithm **hard-codes that assumption** (one shared `shift`/`prevEdge` across all lanes). Real swim lanes exist to show concurrency; SSSF's show sequence in separate rows. If you want parallel phases you need a different layout pass (per-lane independent positioning, with true overlap).

**6. No multi-user.** Single `engineer` string from `whoami`. No auth, no tenancy, no notion of "my runs" vs "the team's."

**7. No retention/archival strategy.** SSSF has `archived` (one-way in the UI, no un-archive path). The obs repo has literally none and embeds full transcripts.

**8. No indexes on the trace DB.** `events` has no index on `adw_id`. Add `events(adw_id, rowid)` on day one.

**9. No search or filter in the trace UI.** For "find what went wrong in a long run," scroll-and-read is the only affordance. Add event-type filter + text search early; the type→color taxonomy already exists.

**10. The synced-triad drift tax.** The output contract lives in three hand-maintained places (Pydantic type, `## Report` JSON example in `user.md`, `output_type=` at the call site). The README lists drift as a real failure mode that "burns correction rounds." **Generate the `## Report` example from the schema at render time** and this class of bug disappears. Same for a JSON-schema-constrained decode if your model supports it.

**11. Placeholder quality commands that exit 0.** The README's own #1 failure mode: *"your test phase is theater"* until you wire real commands. A gate that silently passes is worse than no gate. **[INFERENCE]** make unwired checks fail loudly, not pass quietly.

**12. Gates can't judge quality.** *"Gates check what a predicate can check, not plan quality or code taste."* That's what the reviewer is for — which is why your multi-lens reviewer is the right instinct, and why `verdict_consistent` (validating the reviewer's self-consistency) matters.

**13. Subagent work is invisible.** `subagents.ts` spawns background pi subagents; only the `subagent_create` tool call is traced. The subagent's own tool calls never reach `sssf.db`. **[INFERENCE]** if your planner uses multiple perspectives via subagents, you need to thread trace context into them or you lose the interesting half of the trace.

**14. No cost budget or circuit breaker.** Cost is measured beautifully and enforced nowhere. No per-run cap, no alert, no abort-on-spend.

**15. Nothing connects the two repos.** SSSF does not use the hooks observability system, and the observability system knows nothing about phases, gates, envelopes, or cost. **[INFERENCE]** for a Claude Code-based factory you'd want both: hooks give you fine-grained in-agent events for free, while the phase/gate/envelope model gives you the structure hooks can't see. They compose — hook events keyed by your `phase_id` would give you SSSF's structure *and* the obs repo's granularity.

### 6.3 Direct implications for your design

| Your component | What to take | What to build fresh |
|---|---|---|
| **Ticket system** (Projects/Tickets/Designs) | four-line request shape; `specs/<id>_<slug>.md`; ticket status drives which ADW runs | everything else — SSSF has no ticket layer |
| **Planner with grill-me interrogation** | typed `PlanOutput`, spec file into `context_handoff/` + repo, `notes_for_next_agent` | the interrogation loop itself; multi-perspective (product/eng/UX) — SSSF's planner is single-voice with optional recon subagents |
| **Builder** | `BuildOutput.changed_files` + `diff_matches_claims` gate; unrestricted writes minus `protected_files` | worktree isolation |
| **Multi-lens reviewer** | `ReviewOutput{approved, findings[{requirement, met, evidence}], blocking[]}`; `verdict_consistent` gate; bounded revise loop; **review ≠ test** | the multiple lenses; per-lens envelopes |
| **Documenter / librarian** | `DocumentOutput`; deterministic `changes.capture()` diff against a **pinned baseline**; documenter gets the diff as an envelope | wiki structure, cross-linking, incremental updates |
| **Observability** | the full 7-table schema; 10 event types; rowid-cursor polling; compiled-prompt files; cost/context/cache split; `processes` | indexes; search/filter; parallel-safe lane layout; retention |
| **Agent invocation** | phase primitive; envelope + gate + correction-in-same-session | the Claude Code / Agent SDK adapter (`agent_cc.py` is a stub — you're writing it) |

---

## 7. IndyDevDan's vocabulary and framework

**Important sourcing note:** his densest *written* statement of the framework is the **super-simple-software-factory README itself** — that is where almost every structural term is defined in his own words. The course pages carry the pedagogy vocabulary (Core Four, R&D, PITER, ZTE, Agentic Layer). YouTube *descriptions* could not be retrieved (watch pages truncate under fetch; mirrors returned 401/403/429/CAPTCHA), but **exact titles** were recovered via the YouTube oembed API.

### 7.1 Architectural vocabulary (all from the SSSF README unless noted)

Source: https://github.com/disler/super-simple-software-factory

| Term | His definition (quoted) |
|---|---|
| **ADW — AI Developer Workflow** | *"An ADW script (AI Developer Workflow) owns sequencing, retries, and acceptance. Agents work inside named phases."* Concretely a thin `uv run` Python script whose chain is its docstring. Rule: **"ADW scripts never name a model, they name an agent."** The TAC page glosses ADW as *"combining deterministic code with non-deterministic agents"* (https://agenticengineer.com/tactical-agentic-coding) |
| **Software factory** | *"A software factory does one thing: it gives you more leverage on your prompt. How much leverage depends entirely on what you invest in it. At the low end you chain two agents together and hope. At the high end you build a system of agents plus code that runs without you, and does the job about as well as you would."* Repo subtitle: *"Deterministic Python owns the graph. Coding agents are bounded nodes inside it."* |
| **"Agent proposes, code disposes."** | His central slogan, bolded in the README. Illustrated by the commit phase: the builder *proposes* a commit message as an envelope field; code decides whether to use it and performs the write. *"The agent never runs `git commit` itself."* |
| **Phase** | The unit of work and the unit of the trace. *"**engineer** is the human lane. **agent** is `ph.call(...)`: prompt in, typed envelope out, gates verified. **code** is a deterministic step that stands on its own, like a commit or a migration, and it is never buried inside an agent phase."* Plus: **"Success must be earned."** |
| **Envelope** | *"An agent has exactly two output channels: reference files written into `context_handoff/`, and a final valid-JSON response parsed against the output type the call declared."* |
| **Context handoff** | *"Context transfers in code, not in conversation."* |
| **Gate** | *"Gates verify claims, never predictions."* They run after the fact against the envelope's own declarations. Signature `gate(envelope, run) -> GateReport`. Gates are *"the definition of done."* |
| **Correction (vs restart)** | *"When JSON does not parse or a gate returns violations, **nothing restarts**. The harness re-prompts the same session with a correction naming exactly what was wrong... A cold restart throws away everything the agent learned. A correction costs one message."* |
| **Spec** | The planner's artifact, written to `specs/`, named by `adw_id`; the plan the builder implements *"without asking questions."* Ties to Principled AI Coding lesson 5, *"Spec based AI Coding with Reasoning Models"* |
| **plan → build → test → review → document** | Shipped as `adw_simple_sdlc`, which *"lands three commits from three authors."* Notably **no tester agent** — *"because running a suite is a known command and therefore code."* |
| **Roster / agent identity** | *"Config defines who an agent **is**. The ADW call site defines how it is **used**."* And: **"`tools` is a capability list. `writes` is the boundary."** |
| **Harness engineering** | A stamped directory of agent-harness extensions, kept as a **separate layer** from `prompt_engineering/`. The prompt-engineering vs harness-engineering split as distinct tunable layers is directly sourced. Concept origin: https://github.com/disler/fusion-harness |
| **Skill-as-product / "stamping"** | *"The skill is the product."* `install.py` stamps the factory into any repo; re-running is safe and doubles as a drift check. |
| **Observable / Customizable / Reusable** | His three principles. *"If you cannot measure your agents, you cannot improve them."* |

### 7.2 Conceptual / course vocabulary

| Term | Definition & source |
|---|---|
| **The Big Three — Context, Model, Prompt** | *"winners are those who can clearly communicate the right CONTEXT, select the right MODEL, and design the right PROMPT"* — https://agenticengineer.com/principled-ai-coding |
| **The Core Four — Context, Model, Prompt, Tools** | *"Context, model, prompt, tools -- the core four."* — https://agenticengineer.com/top-2-percent-agentic-engineering. Operationalized in the README: *"One YAML file sets the core four for every agent: context, model, prompt, tools."* **Note:** VALUE.md gives a *different* core four — model+thinking, prompt engineering (system+user), harness engineering, tool selection. Both are his; they don't quite agree. |
| **R&D Framework** | TAC Agentic Horizon lesson 9, *"Elite Context Engineering — R&D Framework covering 12 context window techniques"* (https://agenticengineer.com/tactical-agentic-coding). ⚠️ The expansion **Reduce & Delegate** comes from a *third-party* write-up, not his own words. Treat as probable, not sourced. |
| **Agentic Layer** | TAC lesson 8, *"The Agentic Layer"*, the *"meta-tactic for irreplaceability in Phase 2"*; Agentic Horizon lesson 14 covers *"building Agentic Layers toward autonomous codebases."* Used operationally in SSSF's `how_to_prompt_for_the_eng.md`: *"You operate only on the agentic layer, the ADWs, the software factory."* |
| **In the loop → out of the loop → ZTE** | His autonomy ladder. ZTE is TAC lesson 7, *"ZTE: The Secret of Agentic Engineering."* ⚠️ The expansion "Zero Touch Engineering" appeared only in a search summary, not a fetched page. |
| **Codebase Singularity** | The North Star: the state where your codebase ships itself. Agentic Horizon lesson 14. |
| **Vibe coding vs agentic engineering** | His sharpest formulation, in the SSSF README: *"Vibe coding is not knowing how your system works, and not looking. Agentic engineering is knowing how your system works so well that you do not have to look."* Course framing: **Phase 1 = AI Coding / Vibe Coding**, **Phase 2 = Agentic Coding**. Site-wide evolution model: **"Augment, Automate, Deprecate"** (https://agenticengineer.com/) |
| **"Build systems that build systems"** | https://agenticengineer.com/top-2-percent-agentic-engineering. Adjacent slogan: *"Stop Coding Start Templating"* |
| **"The prompt is the new fundamental unit of knowledge work & programming"** | https://agenticengineer.com/ and https://agenticengineer.com/state-of-ai-coding/engineering-with-exponentials |
| **Compute ≈ success** | *"There is now a causal relationship between the amount of compute you can consume and the amount of value you can produce."* On-page as "COMPUTE === SUCCESS", plus a **Compute Advantage** equation: `(Compute Scaling × Autonomy) / (Time + Effort + Monetary Cost)` — https://agenticengineer.com/state-of-ai-coding/engineering-with-exponentials |
| **IDK — Information-Dense Keywords** | PAIC lesson 3, *"Know your IDKs: Crafting the PERFECT Prompt."* ⚠️ Lesson title verified; the acronym expansion is inferred. |
| **Meta-Agent** | *"the agent that builds agents"* — https://github.com/disler/claude-code-hooks-mastery |
| **Infinite Agentic Loop** | *"An experimental project demonstrating Infinite Agentic Loop in a two prompt system using Claude Code"*, dispatching sub-agents in **waves** — https://github.com/disler/infinite-agentic-loop |
| **Agentics** (noun) | *"skills, agents, and prompts"* as a distributable unit — https://github.com/disler/the-library |

### 7.3 Why code owns the control loop — his own argument, quoted

All from https://github.com/disler/super-simple-software-factory. This is the strongest material and the direct answer to the design question:

> "Everyone can get an agent to write code once. Almost nobody gets the same result twice. This fixes that by moving the control plane out of the prompt and into Python."

> "Hand a capable model your whole SDLC and you get a machine with no seams. There is no phase boundary, so you cannot say which step failed. There is no acceptance criterion you can name, so 'done' means 'the agent stopped talking.' A retry is a cold start that throws away everything the agent just learned. The only trace is a transcript you have to read like a novel. Run it twice, get two different systems."

> "The fix is not a better prompt. The fix is deciding, deliberately, that **code owns sequencing, retries, and acceptance, and the agent owns only the work inside one bounded phase**. Everything else falls out of that one line."

On when *not* to use an agent:

> "Code costs nothing. It runs at the speed of light. You can change it in a second. And you actually own it, which is not true of any model you are renting by the token."

> "`bun test` is not a judgement call. Neither is `ruff check`. An agent rediscovering your test runner burns a context window to learn what a subprocess already knows... Worse, it puts a passing test suite into a context window, which buys you nothing at all."

> "Agents are for the parts that need reading and deciding. Everything else is a `kind="code"` phase."

The thesis line: **"Same models. Same prompts. The difference is who owns the loop."**

And the honest-limits framing, worth borrowing wholesale:

> "Is this overkill for a one-off feature? Yes. Prompt an agent and move on. This earns its keep when the same workflow runs a hundred times, when validation is the only thing standing between you and a bad merge, and when you need the thousandth run to look like the first."

### 7.4 His key repos

| Repo | Description | URL |
|---|---|---|
| super-simple-software-factory | The canonical ADW source. ~695★ | https://github.com/disler/super-simple-software-factory |
| ↳ `example` branch | Same skill stamped in, with a demo app + specs/docs from real runs | https://github.com/disler/super-simple-software-factory/tree/example |
| inkwell-agent-sandboxes-and-software-factory | The factory + rebootable throwaway-VM sandboxes. *"A system that needs you at every step does not scale."* ~122★ — **directly relevant to your isolation gap** | https://github.com/disler/inkwell-agent-sandboxes-and-software-factory |
| fusion-harness | Two-model Pi harness. *"Fuse frontier models instead of racing them. AND, not OR."* Defines harness engineering + gates. ~267★ | https://github.com/disler/fusion-harness |
| the-verifier-agent | *"A two-agent system... that treats verification as a first-class problem, not an additional human-in-the-loop workflow."* ~158★ | https://github.com/disler/the-verifier-agent |
| claude-code-hooks-mastery | Deterministic control over Claude Code via 13 hook events; Meta-Agent pattern. ~3,893★ | https://github.com/disler/claude-code-hooks-mastery |
| claude-code-hooks-multi-agent-observability | *"Real-time monitoring and visualization for Claude Code agents through comprehensive hook event tracking."* ~1,519★ | https://github.com/disler/claude-code-hooks-multi-agent-observability |
| infinite-agentic-loop | Two-prompt system dispatching sub-agent waves. ~611★ | https://github.com/disler/infinite-agentic-loop |
| the-library | *"A meta-skill for private-first distribution of agentics across agents, devices, and teams."* ~408★ | https://github.com/disler/the-library |
| pi-vs-claude-code | Open-source PI agent vs closed-source Claude Code. ~1,613★ | https://github.com/disler/pi-vs-claude-code |
| claude-code-is-programmable | *"Scale your compute with Claude Code as a programmable agentic coding tool"* — the clearest ADW precursor (Jun 2025) | https://github.com/disler/claude-code-is-programmable |
| single-file-agents | *"What if we could pack single purpose, powerful AI Agents into a single python file?"* ~437★ | https://github.com/disler/single-file-agents |
| just-prompt | MCP server, unified interface to major LLM providers. ~737★ | https://github.com/disler/just-prompt |
| pocket-pick | *"What if the exact code snippet or idea you were looking for was one prompt away?"* ~206★ | https://github.com/disler/pocket-pick |
| aider-mcp-server | *"Minimal MCP Server for Aider"* ~305★ | https://github.com/disler/aider-mcp-server |
| indydevtools | *"An opinionated, Agentic Engineering toolbox powered by LLM Agents to solve problems autonomously."* Mar 2024 — earliest | https://github.com/disler/indydevtools |
| agent-sandbox-skill / fork-repository-skill | Isolated execution envs; branching agent work by forking repos | https://github.com/disler/agent-sandbox-skill |
| nano-agent | MCP server for engineering agents, multi-provider | https://github.com/disler/nano-agent |

### 7.5 Course curriculum

**Tactical Agentic Coding (TAC)** — https://agenticengineer.com/tactical-agentic-coding
*"Master the tactics of Agentic Coding. Scale FAR beyond AI Coding and Vibe Coding."* $599, 8 lessons / 6.5 hrs. Explicitly *"not for beginners"* — targets *"the top 20% of engineers."*

1. Hello Agentic Coding — Become the Engineer They Can't Replace
2. The 12 Leverage Points of Agentic Coding *(Core Four + 8 more)*
3. Success is Planned: The 80-20 of Agentic Coding
4. AFK Agents: Let Your Product Build Itself *(PITER framework)*
5. Close The Loops: More Compute, More Confidence
6. Let Your Agents Focus: Agentic Review and Documentation
7. ZTE: The Secret of Agentic Engineering
8. The Agentic Layer

**Agentic Horizon** (paid upgrade): 9. Elite Context Engineering *(R&D Framework, 12 context-window techniques)* · 10. Agentic Prompt Engineering *(seven-level hierarchy)* · 11. Building Domain-Specific Agents · 12. Multi-Agent Orchestration: One Agent To Rule Them All · 13. Agent Experts *(Act, Learn, Reuse)* · 14. The Codebase Singularity

**Principled AI Coding (PAIC)** — https://agenticengineer.com/principled-ai-coding — $299, 8 lessons / 6 hrs, organized around the Big Three: 1. Hello AI Coding World · 2. Multi-File Editing: STOP coding, START prompting · 3. Know your IDKs · 4. How to Suck at AI Coding · 5. Spec based AI Coding with Reasoning Models · 6. Aider Has a Secret · 7. Let the code write itself · 8. Principled AI Coding

Positioning: PAIC = Phase 1 (Augment); TAC = Phase 2 (Automate).

### 7.6 Videos — titles confirmed via oembed; descriptions NOT retrievable

| Title (verbatim) | URL |
|---|---|
| **My Super Simple Software Factory (For Agentic Engineers)** | https://youtu.be/haUfb1ievTE |
| Claude Code Multi-Agent Orchestration with Opus 4.6, Tmux and Agent Sandboxes | https://youtu.be/RpUTF_U4kiw |
| Engineers… Your Software Factory NEEDS Agent Sandboxes to SCALE (exe.dev) | https://youtu.be/SEI_qIW4o2c |
| My Claude Code Sub Agents BUILD THEMSELVES | https://youtu.be/7B2HJr0Y68g |
| Engineers... STOP Picking GPT-5.6 Sol OR Claude Fable 5… FUSE THEM | https://youtu.be/AQl5Q-0l7FQ |
| Infinite Agentic Loop with Claude Code | https://youtu.be/9ipM_vDwflI |
| *(the-verifier-agent breakdown — title not fetched)* | https://youtu.be/EnXKysJNz_8 |
| *(hooks: team workflows / `/plan_w_team`)* | https://youtu.be/4_2j5wgt_ds |
| *(hooks: output styles & status lines)* | https://youtu.be/mJhsWrEv-Go |

**On the observability videos:** the current obs README links only **RpUTF_U4kiw**. A search snippet suggested the README once referenced an "original breakdown" and a "Haiku 4.5 vs Sonnet 4.5" enhancement video, but those links are **not in the README today** and the IDs could not be recovered. Treat the original mid-2025 observability video as **unverified**.

### 7.7 ⚠️ Explicitly NOT verified — do not attribute these to him

- **"Compute is the new oil"** — no evidence he says this. His formulation is "COMPUTE === SUCCESS". The phrase traces to Kalshi's CEO in commodities coverage.
- **"Your prompt is your product"** — no source found. Closest real quote: *"The prompt is the new fundamental unit of knowledge work & programming."*
- **"Living off the land"** — no source found in his material.
- **"Primitives" as a named framework** — appears only loosely (*"a new engineering primitive"*) in third-party summaries. **However**, VALUE.md does use *"In-distribution primitives"* as a section heading, meaning Python + Skills + Prompts: *"In-distribution primitives mean **the models already know how to work on this system.**"*
- **"IDD"** — does not appear to exist as a framework. You are likely thinking of **IDK**.
- **PITER acronym expansion** — the framework is real (TAC lesson 4) but no source states what the letters stand for.
- **"Envelopes" and "gates" as *course* vocabulary** — verified in the repos; not visible on the course pages.
- **ADW evolution timeline** — no dated "first ADW" artifact found. Documented chain: `indydevtools` (Mar 2024) → `claude-code-is-programmable` (Jun 2025) → ADW named and formalized in `super-simple-software-factory` (2026). The middle link is an inference from repo dates, not from him saying so.
- **"Agent proposes, code disposes"** is verbatim and bolded in the **SSSF README** — cite that, not `the-verifier-agent`.

### 7.8 The four-part seam — the borrowable core

If you borrow one thing from his vocabulary, borrow this quartet, which is what makes "code owns the loop" implementable rather than a slogan:

1. **Phase** — the unit of the trace
2. **Envelope** — the typed contract across the seam
3. **Gate** — post-hoc verification of claims
4. **Correction, not restart** — repair inside the live session

---

## 8. All sources

**Repos read directly from source:**
- https://github.com/disler/super-simple-software-factory (branch `main`)
- https://github.com/disler/super-simple-software-factory/tree/example (branch `example`)
- https://github.com/disler/claude-code-hooks-multi-agent-observability

**Referenced within those repos:**
- https://youtu.be/haUfb1ievTE — "My Super Simple Software Factory (For Agentic Engineers)"
- https://youtu.be/RpUTF_U4kiw — multi-agent orchestration deep dive (linked from the obs README)
- https://github.com/mariozechner/pi-coding-agent — the `pi` coding agent SSSF v1 runs
- https://agenticengineer.com/tactical-agentic-coding?y=sssf — linked from the SSSF README
- https://www.youtube.com/@indydevdan

**Course / site pages:**
- https://agenticengineer.com/
- https://agenticengineer.com/tactical-agentic-coding
- https://agenticengineer.com/principled-ai-coding
- https://agenticengineer.com/top-2-percent-agentic-engineering
- https://agenticengineer.com/state-of-ai-coding/engineering-with-exponentials

**Other disler repos cited:** see the table in §7.4.

**Key files read (paths relative to repo root):**
- SSSF: `README.md`, `VALUE.md` (example branch), `.claude/skills/sssf/SKILL.md`, `cookbooks/{sssf_overview,how_to_prompt_for_the_eng,run_adw}.md`, `references/{handoff,observability}.md`, `templates/sssf.config.yaml`, `templates/adws/adw_modules/{data_types,tracer,session,runner,gates,prompts,agents,agent_pi,agent_cc,permissions,quality,changes,console}.py`, `templates/adws/{adw_simple_sdlc,adw_build_review}.py`, `templates/prompt_engineering/{planner,reviewer}/*.md`, `apps/visualizer/{server/index.ts,server/db.ts,shared/types.ts,src/**}`, `justfile`, `.gitignore`
- Obs: `README.md`, `.claude/settings.json`, `.claude/hooks/*.py`, `.claude/hooks/utils/*.py`, `app_docs/{how_human_in_the_loop_v1_works,send_event_with_model_how_to}.md`, `apps/server/src/{db,index,types,theme}.ts`, `apps/client/src/**`, `scripts/*.sh`
