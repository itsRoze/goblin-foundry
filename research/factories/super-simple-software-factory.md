# Super Simple Software Factory (SSSF)

- **URL:** https://github.com/disler/super-simple-software-factory (video: https://youtu.be/haUfb1ievTE ; stamped example on the `example` branch)
- **Type:** factory (a Claude Code *skill* that stamps a Python-orchestrated agent pipeline into any repo)
- **Author/Org:** Dan Disler (IndyDevDan, agenticengineer.com / "Tactical Agentic Coding")
- **Researched:** 2026-08-26
- **Status/maturity:** 751 stars, 187 forks, 12 open issues. Created 2026-08-02; effectively a single "🚀" commit (plus pushes through 2026-08-04). MIT. Brand new, unlikely to be iterated in-place — Disler's repos are typically one-shot teaching artifacts; follow-on work landed in `disler/inkwell-agent-sandboxes-and-software-factory`.

## One-paragraph summary

SSSF is a ~100-file Claude Code skill (`.claude/skills/sssf/`) that, when you type `/sssf install`, stamps a small Python "software factory" into the current repo: twelve `adws/adw_*.py` scripts (ADW = "AI Developer Workflow"), an `adw_modules/` library, a YAML agent roster, per-agent `system.md`/`user.md` prompts, a `justfile`, and a SQLite trace DB with a Vue visualizer. The thesis in one line: **"Agent proposes, code disposes."** Deterministic Python owns the graph — sequencing, retries, acceptance, commits — and coding agents (the Pi coding agent in v1; Claude Code is stubbed for v2) are bounded nodes inside named phases. Agents communicate only through typed JSON envelopes (Pydantic) and files in a `context_handoff/` dir; envelopes are checked by post-hoc *gates*; failures are sent back into the *same* agent session as corrections rather than restarting; and every event streams into a WAL SQLite db (`adws/adw_data/sssf.db`) that the UI merely polls. The orchestrating Claude Code session that invokes the skill is explicitly told to *operate* the factory and never do the work itself.

## Core ideas / thesis

- **Repeatability is the product.** "Everyone can get an agent to write code once. Almost nobody gets the same result twice." The fix is moving the control plane out of the prompt into code.
- **Three actors, kept separate:** the engineer, the code, the agents. Phases are `kind="engineer" | "agent" | "code"` and rendered as three swim lanes.
- **A known command is code, not an agent.** `bun test`, `ruff check` are `kind="code"` phases (`adw_modules/quality.py`). "An agent rediscovering your test runner burns a context window to learn what a subprocess already knows." There is deliberately **no tester agent**.
- **Envelopes, not conversation.** Exactly two agent output channels: files in `context_handoff/` and one final JSON envelope parsed against a Pydantic type. Code persists it and injects it into the next agent's prompt.
- **Gates verify claims, never predictions.** Run *after* the agent, against what the envelope declared (`artifacts_exist`, `files_non_empty`, `json_parses`, `diff_matches_claims`, `verdict_consistent`, `tests_pass(cmd)`).
- **Corrections, not restarts.** Parse failures and gate violations re-prompt the same session (Pi treats `--session-id` as create-or-continue). "A cold restart throws away everything the agent learned. A correction costs one message."
- **Success must be earned.** Every phase defaults to `fail`; `run.finish(accepted=...)` separates "phases ran" from "run is acceptable".
- **Permissions enforced after the fact by diffing the tree**, because `tools:` lists are unenforceable (`bash` can `git checkout`, `write` reaches any path).
- **Observable / Customizable / Reusable** — the three design properties; "the skill is the product"; "no DSL… Python, YAML, agents, and a skill — staying in distribution is a feature."
- **Model-per-phase economics:** planner on a frontier model with `thinking: high`, builder on a cheap fast model, reviewer with no write ability. "It is not about which model is best anymore, it is about which model is right for that one phase."

## Architecture & mechanics

### Skill layout (what you copy) and what it stamps

```
.claude/skills/sssf/
  SKILL.md                         # hard rules + routing table (lazy-loads cookbooks)
  cookbooks/  install.md create_adw.md run_adw.md update_adw.md create_config.md update_config.md
              update_modules.md sssf_overview.md how_to_prompt_for_the_eng.md
  references/ config.md handoff.md observability.md
  scripts/    install.py make_config.py make_adw.py
  apps/visualizer/                 # Vue+Vite on Bun, port 4600, read-only over sssf.db
  templates/                       # EXACTLY what install.py stamps
    sssf.config.yaml               # → adws/adw_sssf_config/sssf.config.yaml
    justfile, env.sample
    prompt_engineering/{planner,builder,scout,reviewer,documenter}/{system.md,user.md}
                                   # → adws/adw_data/prompt_engineering/
    harness_engineering/{subagents.ts,themeMap.ts}   # Pi extensions → adws/adw_data/harness_engineering/
    adws/adw_*.py (12)             # → adws/
    adws/adw_modules/              # agents.py agent_pi.py agent_cc.py(stub) gates.py permissions.py
                                   # quality.py runner.py session.py tracer.py data_types.py
                                   # changes.py git_helper.py prompts.py console.py utils.py
```

Runtime (gitignored): `adws/adw_data/sessions/{adw_id}/` and `adws/adw_data/sssf.db`.

### Install

```bash
cp -r super-simple-software-factory/.claude/skills/sssf .claude/skills/
uv run .claude/skills/sssf/scripts/install.py      # idempotent; --force overwrites everything incl. config+prompts
cp .env.sample .env                                 # OPENROUTER_API_KEY etc.
just demo   # = uv run adws/adw_prompt.py "reply with a one-line summary of this repo" --agent scout
just sessions; just obs
```
Prereqs: `uv`, `pi` (Pi coding agent), `sqlite3`, optional `bun`/`just`.

### The roster (`sssf.config.yaml`)

```yaml
defaults:
  coding_agent: pi                 # claude_code is schema-valid but agent_cc.py raises in v1
  model: google/gemini-3.6-flash   # provider/model-id required (bare id may match several providers)
  thinking: medium
  protected_files: [adws/adw_modules/, adws/adw_sssf_config/, adws/adw_*.py]   # nobody edits the grader
  data_dir: adws/adw_data
agents:
  - name: planner
    model: fireworks/accounts/fireworks/models/kimi-k3
    thinking: high
    color: "#a78bfa"
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering: { system: .../planner/system.md, user: .../planner/user.md }
    harness_engineering: [adws/adw_data/harness_engineering/subagents.ts]
    writes: [specs/]               # None = unrestricted, [] = read-only, [...] = only these
```
Five starter agents: `planner`, `builder`, `scout` (read-only), `reviewer` (read-only), `documenter`. The starter roster deliberately spans three providers (OpenRouter/Gemini, Fireworks/Kimi, OpenAI GPT-5.6) to make the "model per phase" point. "ADW scripts never name a model, they name an agent."

### The phase primitive (from `adw_plan_build_test_quality.py`)

```python
REQUIRED_AGENTS = ["planner", "builder"]; MAX_FIX_LOOPS = 3
cfg = agents.load_config(config); agents.validate(cfg, REQUIRED_AGENTS)   # fail before anything spawns
run = session.ensure(cfg, adw_id)                                           # mint or join adw_id

with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer, description="Capture the incoming ask")) as ph:
    ph.log(input=prompt)
with run.phase(PhaseParams(name="plan", kind="agent", owner="planner", description="Turn the request into an implementable plan")) as ph:
    plan = ph.call(AgentCall(output_type=PlanOutput, prompt=prompt, gates=[gates.artifacts_exist, gates.files_non_empty]))
with run.phase(PhaseParams(name="build", kind="agent", owner="builder", description="Implement the plan exactly")) as ph:
    previous = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt, previous=plan, gates=[gates.diff_matches_claims]))
for i in range(1, MAX_FIX_LOOPS + 1):
    with run.phase(PhaseParams(name=f"verify_{i}", kind="code", owner="quality", ...)) as ph:
        quality_result = quality.run_quality(run)                          # lint/typecheck/build/test as argv lists
    if quality_result.passed: break
    with run.phase(PhaseParams(name=f"fix_{i}", kind="agent", owner="builder", retries=1, ...)) as ph:
        previous = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt,
                                     previous=quality.as_envelope(broken, what),   # failure output becomes the spec
                                     gates=[gates.diff_matches_claims]))
if verified:
    with run.phase(PhaseParams(name="commit", kind="code", owner="git", ...)) as ph:
        ph.log(sha=git_helper.commit_all(previous.commit_message or f"sssf({run.adw_id}): {previous.summary}"))
return run.finish(accepted=verified, reason="verify/test never came back clean after 3 fix attempt(s)")
```

Note the commit phase: the builder *proposes* `commit_message` in its envelope; code decides, falls back, and performs `git commit`. "The agent never runs `git commit` itself." `PhaseParams.description` is mandatory and rejected if it merely restates the name.

### One agent call (`agents.execute`, ~120 lines)

1. Render `system.md`/`user.md` with `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`; save the exact prompts under `sessions/<adw_id>/<agent>/prompts/`.
2. `permissions.snapshot(run)` — fingerprint `git diff HEAD --numstat` + untracked files.
3. `agent_pi.run(PiRequest(... session_id, tools, extensions, cwd=repo_root))`, tailing Pi's JSONL stdout into the tracer live (three raw Pi events folded into one `tool_call` row).
4. `_parse_with_retries` — up to `JSON_FIX_ATTEMPTS=2` corrections into the same session; tolerates fenced JSON/prose; invalid attempts persisted as invalid envelope rows. `status:"fail"` in a valid envelope still fails the phase.
5. Gates loop — up to `phase.retries` rounds; violations sent back as `"Your previous response failed validation:\n- …\n\nFix these problems, then re-emit ONLY your Report JSON."`
6. `permissions.enforce` — compare tree; anything outside `writes:` (or in `protected_files`) → `PermissionBreach`: rollback, phase dies (not retryable — "the write already happened"). Reverting a dirty file counts as a change (catches `git checkout`).
7. Persist `envelope.json`, update `agent_map.json` (agent → session_id + model), record context/usage.

### Envelopes (`data_types.py`, `references/handoff.md`)

```python
class EnvelopeBase(BaseModel):
    status: Literal["success","fail"]; summary: str = ""; artifacts: list[str] = []; notes_for_next_agent: str = ""
class PlanOutput(EnvelopeBase):   commit_message: str = ""
class BuildOutput(EnvelopeBase):  changed_files: list[str] = []; commit_message: str = ""
class ScoutOutput(EnvelopeBase):  findings: list[ScoutFinding]
class ReviewOutput(EnvelopeBase): approved: bool = False; findings: list[ReviewFinding]; blocking: list[str] = []
class DocumentOutput(EnvelopeBase): document_path, documented_files, commit_message
# adapters: VerifyOutput (a lint/test block result), ChangesOutput (a captured git diff) — code shaped as an envelope
```
"The output contract is a synced triad": the Pydantic type, the `## Report` JSON example in `user.md`, and `output_type=` at the call site — change one, change all three.

### Session directory

```
adws/adw_data/sessions/{adw_id}/
  agent_map.json      # agent → {session_id, model, coding_agent}; lets a later ADW resume each agent's context window
  context_handoff/    # the ONE place agents write files for later agents (plan.md, scout_findings.md, quality/NN_name/)
  {agent}/prompts/ {agent}/pi_sessions/ {agent}/raw_output.jsonl {agent}/envelope.json
```
`--adw-id` joins a session: `adw_plan.py "add /health"` → prints id → `adw_build_test.py "implement the plan" --adw-id <id>` resumes the builder's own session. If config drift changes an agent's model, that agent starts fresh (never a bad resume).

### Trace (`tracer.py`, `references/observability.md`)

Seven tables: `sessions, phases, events, envelopes, gate_results, agent_sessions, processes`; ten event types; `parent_id` nests spans. Single transport: `select * from events where adw_id=? and rowid>? order by rowid limit 500` — no websocket, no ingest endpoint; live view and replay are the same query. `processes` maps adw_id → pid so a hung agent can be killed children-first ("a killed run finalizes its own trace to fail"). Files are the raw record; the db is a rebuildable mirror. `justfile` wraps: `just sessions`, `just phases <id>`, `just tail <id>`, `just procs <id>`.

### The twelve ADWs

| ADW | Chain |
|---|---|
| `adw_prompt` | engineer → any one agent (`--agent NAME`) |
| `adw_scout` | read-only recon |
| `adw_plan` | planner → `specs/<adw_id>_<slug>.md` |
| `adw_build` | builder (plan exists) |
| `adw_quality` | code only: lint/typecheck/build |
| `adw_plan_build` | planner, builder, git(commit) |
| `adw_build_test` | builder, code(test), bounded fix loop |
| `adw_build_review` | builder, reviewer, bounded revise loop |
| `adw_plan_build_test` | plan, build, code(test), commit |
| `adw_plan_build_test_quality` | + lint/typecheck/build gates |
| `adw_document` | code(git diff) → documenter |
| `adw_simple_sdlc` | plan, build, test, review, document — three commits from three "authors" |

### The orchestrator skill (`SKILL.md`) — how Claude Code is used

Claude Code is the *operator*, not a worker. Startup: read `cookbooks/sssf_overview.md`, `ls adws/adw_*.py`, print the ADW table, **stop and wait**. "Volunteered state is guessed state." Routing table lazy-loads one cookbook per request type. Hard rules: never implement/plan/test yourself; never edit `sessions/`; query `sssf.db` only when observing is the task. `how_to_prompt_for_the_eng.md` defines the prompt shape the ADW receives:

```
<the ask — one imperative sentence, their words where they were specific>
Where: <files or dirs you verified>
Done means: <the observable result>
Out of scope: <what you were tempted to add>
```
"The intent is theirs. The precision is yours." Never write the plan; never address the harness in the prompt ("use the reviewer", "retry twice" are chain choices). Report back: the verbatim prompt sent, the ADW chosen and why, the `adw_id`.

### Agent prompts (selected)

- Planner `system.md`: "Read only what you need… Write the full plan to `<context_handoff_dir>/plan.md` … keep a copy under `specs/`… Do not implement anything." Has `subagent_create/_continue/_list/_remove` via the `subagents.ts` Pi extension: "Wait for every one you spawned to report before writing plan.md."
- Planner `user.md`: copies plan with one `cp` rather than re-emitting ("costs the whole document again in output tokens and lets the two copies drift"); never overwrite an existing spec (`_v2`, `_v3`).
- Builder: "Make the smallest change… When fixing test failures, address every reported failure… judge by exit status, never by scanning output for words like `error`."
- Reviewer: "Confirm that what was built is what was asked for. This is not testing… Judge the code on disk, never the builder's summary… Change nothing… `approved` is true ONLY when every requirement is met and `blocking` is empty." Backed by the `verdict_consistent` gate (approved with blocking items, or rejected with no named problem, is refuted without reading the diff).
- Recurring line in every prompt: "You inherit the operator's shell environment… Call tools by bare name… never fall back to an absolute `/usr/bin/*` path."

## Workflow: end to end

1. Engineer opens Claude Code in a stamped repo, types e.g. "add tags on posts sorted by popularity". The `sssf` skill translates it to the four-line prompt (verifying paths exist), picks the ADW by shape ("the more complex the ask, the more complete the chain… when two chains both fit, take the longer one"), and launches `uv run adws/adw_simple_sdlc.py "<prompt>"` (or writes `requests/<slug>.md` and passes the path).
2. `agents.validate` checks the roster; `session.ensure` mints `adw_id`, creates dirs, writes `sessions` row.
3. **plan** (agent): planner writes `context_handoff/plan.md` + `specs/<id>_<slug>.md`, returns `PlanOutput`; gates `artifacts_exist`, `files_non_empty`; code commits the spec with the planner's `commit_message` (commit 1).
4. **build** (agent): builder gets `previous_envelope`=plan, edits code, returns `BuildOutput{changed_files, commit_message}`; gate `diff_matches_claims`; permission diff enforces `writes:`.
5. **verify/test** (code): `quality.run_quality` runs argv blocks (placeholders `echo PLACEHOLDER…` until you edit `quality.py`); failure tail (≤4000 chars) wrapped as `VerifyOutput` envelope → **fix_i** (builder, same session) up to 3 loops.
6. **review** (agent, read-only): `ReviewOutput{approved, findings[{requirement, met, evidence}], blocking}`; `verdict_consistent` gate; if not approved → bounded revise loop back to the builder with `blocking` as spec.
7. **commit** (code) using builder's message (commit 2). **document** (agent) writes the write-up; commit 3.
8. `run.finish(accepted=review.approved, reason=...)` sets exit code, `sessions.status`, and banner together.
9. Engineer/operator watches with `just phases <id>` / the visualizer on :4600; the skill reports phase name/owner/status/error.

Deliberately absent: branch per run, sandbox, merge step, cloud, human-approval phase. "This runs on your current branch."

## Notable techniques worth stealing

- **Phase context manager with `kind ∈ {engineer, agent, code}` + mandatory one-sentence description**: makes the trace, console, and UI self-describing and forces the "is this a judgement call or a known command?" decision at authoring time.
- **Typed envelope + `## Report` JSON example + `output_type=` triad**, with `status` load-bearing and parse-retry into the same session.
- **Gates as post-hoc claim verification** returning a `GateReport` of `check(item, ok, note)` so a green gate says *what* it verified. `verdict_consistent` is a cheap self-consistency check on reviewer output.
- **`quality.as_envelope(result)` / `changes.as_envelope(diff)`**: shape deterministic results as envelopes so the consuming agent "cannot tell the difference".
- **Permission-by-diff**: snapshot before, compare after, treat reversion as modification, `protected_files` for the harness itself ("no agent may edit the machinery that grades it").
- **Agent proposes the commit message; code commits** — one small example of the whole philosophy.
- **`agent_map.json` + `--adw-id`** for resuming each agent's context window across separate workflow invocations; model drift → fresh session.
- **Single-cursor SQLite transport** (`rowid > ?`) with WAL; `processes` table for kill-ability; files as raw record.
- **Operator-skill discipline**: lazy-load cookbooks, "print the menu and wait", never volunteer state, four-line prompt shape, report the verbatim prompt + chosen ADW + id.
- **Per-agent `harness_engineering` extensions** (e.g. give only the planner subagents).
- **Placeholder commands that loudly admit they are fake** (`echo PLACEHOLDER lint: edit quality.py…`) rather than plausible defaults that silently pass.
- **Judge commands by exit status, never by grepping output** — repeated in every prompt.

## Weaknesses / open questions / risks

- **Pi-only in v1.** `coding_agent: claude_code` is schema-valid but `agent_cc.py` just raises; the intended v2 call is documented as `claude -p --output-format stream-json --resume <session_id>`. Porting is straightforward but is work we would own. The README's Pi link (`mariozechner/pi-coding-agent`) 404s; Pi lives in `badlogic/pi-mono`.
- **No isolation at all**: runs on your current branch, on your machine, with your credentials ("You inherit the operator's shell environment"). Permission-by-diff is after-the-fact and cannot undo side effects outside the repo.
- **Placeholders**: `quality.py` exits 0 until edited, so three ADWs' test phases are "theater" on a fresh install (README admits this). `agents.validate` doesn't check API keys; missing keys fail mid-chain.
- **Single-shot repo**: one commit, likely no maintenance; the `example` branch and Inkwell repo are where it evolved. Treat as a pattern library, not a dependency.
- **Gates are shallow by design** (existence, non-empty, JSON parses, diff-matches-claims); plan/code quality relies on the reviewer agent.
- **No merge/branch story, no parallelism**: a chain is strictly sequential; nothing like Sandcastle's parallel implementers.
- **Silent hangs**: a stuck agent produces no events and the trace "goes quiet rather than red" — you must poll `processes` and kill.
- **Cost of the operator layer**: a Claude Code session babysitting Python that babysits Pi is three layers of model; the skill's own rules exist to stop the top layer from wasting context.

## Fit for our agentic stack

- **Adopt the control-plane pattern wholesale**: code owns phases/retries/acceptance; agents are bounded nodes. This is the missing half of Sandcastle (which owns isolation but not acceptance). A `run.phase()`/`ph.call(AgentCall(...))`-style harness in Python or TS is a small amount of code (`agents.py` execute is ~120 lines).
- **Implement `agent_cc.py` for Claude Code**: `claude -p --output-format stream-json --resume <id>` (+ `--allowedTools`, `--permission-mode`, `--append-system-prompt-file` for `system.md`) maps 1:1 onto `PiRequest{prompt, system_prompt, model, session_id, tools, extensions}`. Claude Code's `--json-schema`/structured output could replace the parse-retry loop.
- **Adopt envelopes + gates + permission-by-diff** as our inter-agent contract; run gates inside the Sandcastle worktree/sandbox after each `run()`.
- **Adopt the SQLite trace** (or map to OpenTelemetry) — cheapest observability we've seen; the `processes` table idea matters for kill-ability.
- **Adopt the operator skill shape** as our Claude Code entry point: `/factory <ask>` → four-line prompt → choose chain → launch → observe → report. The "print the menu and wait" and "never volunteer state" rules are worth copying verbatim.
- **Adapt**: replace Pi extensions (`subagents.ts`) with Claude Code subagents/skills; swap `writes:` enforcement for Claude Code hooks (PreToolUse deny on protected paths) *plus* the post-hoc diff.
- **Skip**: the multi-provider roster gimmick (we are Claude-centric; keep the per-phase model/thinking knobs though), the Vue visualizer (replace with our own or reuse — it's read-only over the db).
- **Add what SSSF omits** (it lists them): branch-per-run, sandbox, merge step, human-approval phase — i.e., wrap the chain in Sandcastle-style worktrees and a SwarmForge-style approval gate.

## Related resources mentioned

- `disler/inkwell-agent-sandboxes-and-software-factory` — SSSF stamped into a demo app (Inkwell, Bun blog) plus a **rebootable sandbox tier** on exe.dev VMs (`just sbx mount|lifecycle execute|manage harvest|teardown`), per-run disposable OpenRouter keys with a $50 cap, and Claude Code + Pi running *inside* the sandbox. Directly relevant to the sandbox half of our stack. https://github.com/disler/inkwell-agent-sandboxes-and-software-factory
- `example` branch of SSSF — populated `adws/`, real traces. https://github.com/disler/super-simple-software-factory/tree/example
- Pi coding agent (Mario Zechner) — the v1 backend; `--session-id` create-or-continue semantics, JSONL stdout, extensions API. (Repo: `badlogic/pi-mono`.)
- `disler/fusion-harness` — "Combine Your Compute" (431 stars, active Aug 2026); likely multi-model harness work from the same author. https://github.com/disler/fusion-harness
- Tactical Agentic Coding course — https://agenticengineer.com/tactical-agentic-coding ; IndyDevDan YouTube — https://www.youtube.com/@indydevdan
- Video "My Super Simple Software Factory (For Agentic Engineers)" — https://www.youtube.com/watch?v=haUfb1ievTE
- exe.dev (throwaway VM provider used by Inkwell's sandbox tier).

## Key quotes / references

- "Deterministic Python owns the graph. Coding agents are bounded nodes inside it." / "Agent proposes, code disposes."
- "Hand a capable model your whole SDLC and you get a machine with no seams… 'done' means 'the agent stopped talking.' A retry is a cold start that throws away everything the agent just learned."
- "So when the invocation is already known, write it down. `bun test` is not a judgement call. Neither is `ruff check`."
- "`tools` is a capability list. `writes` is the boundary."
- "Gates verify claims, never predictions."
- "When JSON does not parse or a gate returns violations, nothing restarts."
- "Success must be earned. Every phase defaults to `fail`."
- "One data path, no exceptions: agents write to SQLite, readers poll SQLite."
- SKILL.md: "You run the system, observe the system, and help the user interact with it. You do no ADW work yourself."
- `how_to_prompt_for_the_eng.md`: "The intent is theirs. The precision is yours." / "Never a single-agent chain when the engineer asked for work to be done."
- `permissions.py` docstring: "one [builder] did [`git checkout adws/`], discarding uncommitted changes to the very quality check it was about to be judged by."
- "Vibe coding is not knowing how your system works, and not looking. Agentic engineering is knowing how your system works so well that you do not have to look."

### Gaps
- Did not watch the YouTube video; relied on README + skill docs.
- Did not read `agent_pi.py`, `tracer.py`, `runner.py`, `session.py` or the visualizer source in full.
- `example` branch traces not inspected.
