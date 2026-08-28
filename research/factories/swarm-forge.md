# SwarmForge (swarm-forge)

- **URL:** https://github.com/unclebob/swarm-forge (runnable branches: `two-pack`, `four-pack`, `six-pack`; tag `simple-windows`)
- **Type:** factory (multi-agent orchestration over tmux + git worktrees, with a constitution and a file-based handoff protocol)
- **Author/Org:** Robert C. Martin ("Uncle Bob"); forked from his son Justin Martin's original. 303 of ~309 commits are Uncle Bob's.
- **Researched:** 2026-08-26
- **Status/maturity:** 2,886 stars, 296 forks, 26 open issues. Created 2026-04-17; **very active** — multiple commits per day through 2026-08-26 (the day of research). **No LICENSE file** (all rights reserved by default — a real adoption blocker). Implementation moved from a ~550-line zsh script to Babashka (Clojure) scripts with Speclj tests (`test/swarmforge/*.clj`, ~215KB) and a Playwright test for the dashboard.

## One-paragraph summary

SwarmForge runs a small "pack" of AI coding agents (2, 4 or 6) as long-lived interactive CLIs (`claude`, `codex`, `copilot`, or `grok`) in tmux sessions, each in its own git worktree, each holding a software-craftsmanship *role* — specifier, coder, cleaner/refactorer, architect, hardener, QA. Agents never talk to each other directly: they commit, write a five-line draft (`type: git_handoff / to: / priority: / task:`), and run `swarm_handoff.sh`, which validates it, forces a two-call self-audit, and drops it in an outbox; a Babashka daemon (`handoffd.bb`) copies it into recipient inboxes and sends a generic tmux wake-up ("You have new handoff mail. If idle, run ready_for_next.sh."). Recipients `ready_for_next.sh` (merges the sender's commit into their worktree), do their role's work under a layered *constitution* (TDD, Speclj, Gherkin acceptance tests via Uncle Bob's Acceptance-Pipeline-Specification, mutation testing, CRAP and DRY tools), and forward down the chain. A local web "pack cockpit" gives the human a Kanban board, an Attention panel for spec approvals and clarification questions, a chat rail to the master agent, and Teardown. It is the most opinionated of the three about *engineering discipline* and the least about sandboxing.

## Core ideas / thesis

- **Discipline over autonomy.** The interesting object is the constitution, not the transport: every agent must do TDD, keep testable code separated from IO-bound "environmentally unsuitable" modules, write Gherkin acceptance tests that are themselves mutation-tested, run mutation/CRAP/DRY tools from `github.com/unclebob/*`, and "cover the uncovered, kill survivors."
- **Roles are quality gates.** Each role owns one concern; the pipeline is a fixed chain (`specifier → coder → cleaner → architect → hardender → QA`) and every intermediate role *must* forward, "regardless of what changed."
- **Agents are interactive sessions, not batch jobs.** Each role is a persistent `claude`/`codex` TUI in tmux that keeps its context across tasks; work arrives as mail.
- **Durable file queues; lossy wake-ups.** "Tmux wake-ups are intentionally lossy. They only prompt an idle agent to check its durable inbox." State = file location + headers.
- **The helper scripts are the protocol boundary.** Agents never write SHAs, filenames, tmux commands, or long bodies; `swarm_handoff.sh` is "the strict outbound protocol gate."
- **Self-audit before handoff.** The first `git_handoff` call returns `AUDIT_REQUIRED`; the agent must re-read the task, trace every requirement to evidence, fix findings, and call again with an *unchanged* draft. Only the second identical call queues.
- **Human gates at the spec boundary.** Specifier handoffs wait for Approve/Reject in the dashboard; ambiguity goes to the operator via `pack_dashboard_request.sh clarify`, never to another agent.
- **Everything local, no runtime deps beyond tmux/git/bb**; dogfooded ("SwarmForge builds SwarmForge"); `AGENTS.md` forbids unit-testing prompt wording.
- Layered law: `main` owns shared articles (`engineering.prompt`, `handoffs.prompt`, `workflow.prompt`); packs may only *add* `project.prompt` / `local-*.prompt`, never replace a shared filename.

## Architecture & mechanics

### Repo layout (`main`)

```
get-swarm-forge                 # installer: fetch main scripts+shared articles, overlay a pack branch
close-swarm                     # teardown
swarmforge/
  constitution/articles/{engineering,handoffs,workflow}.prompt   # shared law
  handoff-protocol.md           # 20KB protocol spec ("Handoff Daemon Proposal")
  scripts/
    swarmforge.bb (40KB)        # launcher: parse conf, worktrees, tmux, daemon, dashboard, sleep inhibitor
    handoffd.bb (15KB)          # delivery daemon; owns the tmux socket
    swarm_handoff.bb (36KB)     # outbound validation + audit gate
    ready_for_next{,_task,_batch,_guard}.bb, done_with_current{,_task,_batch}.bb
    merge_and_process.bb        # `git merge` of sender commit into recipient worktree
    pack_web.bb (59KB) + pack/dashboard.html (37KB)   # the cockpit HTTP server/UI
    pack_board.bb, pack_dashboard_request.bb          # board state, clarify/approve requests
    swarm_tool.bb               # `swarm_tool.sh require|ensure <tool>` (speclj, gherkin-parser, crap4clj…)
    commit-msg-hook.bb          # appends "By <role>." to every commit
    swarm-window-watchdog.bb, swarm-terminal-adapter.sh, terminal-adapters/{ghostty,iterm2,terminal-app,windows-terminal,none}.sh
    *.sh                        # thin wrappers around each .bb
issues.md, platoon-brainstorm.md, AGENTS.md, bb.edn
test/swarmforge/{handoff_test,pack_ui_test,script_test}.clj, test/dashboard/dashboard.spec.js
```

A pack branch (e.g. `four-pack`) adds:

```
swarm                                    # bootstrap wrapper → swarmforge/scripts/swarmforge.sh
swarmforge/swarmforge.conf
swarmforge/constitution.prompt           # "Read and obey every file in swarmforge/constitution/articles/"
swarmforge/constitution/articles/{project,local-workflow,local-engineering}.prompt
swarmforge/roles/{specifier,coder,refactorer,architect}.prompt
```

### `swarmforge.conf` (four-pack)

```conf
# window-invisible <role> <agent> <worktree> [task|batch] [extra-cli-args...]
window-invisible specifier codex master --yolo
window-invisible coder codex coder --yolo
window-invisible refactorer codex refactorer --yolo
window-invisible architect codex architect batch --yolo
```
Exactly one role must use worktree `master` (runs in the main checkout; it is the "master agent" the dashboard's New Task / chat talk to). Others get `.worktrees/<name>` on branch `swarmforge-<name>`. `batch` mode makes a role consume all equal-priority queued handoffs as one unit (cleaner/architect/hardener/QA). Extra args pass straight to the CLI — for Claude: `window architect claude wt-arch task --dangerously-skip-permissions`. Allowed agents: `claude codex copilot grok`.

### Startup (`./swarm` → `swarmforge.bb`)

1. Parse conf; validate role prompts, helper scripts, terminal adapter; require constitution file.
2. `git init` + first commit if needed; ensure `.swarmforge/` and `.worktrees/` are gitignored.
3. Create one worktree per role; copy `swarmforge/scripts/` and `swarmforge/constitution/` *into each worktree* and prepend that local scripts dir to the agent's `PATH` (agents never reach back into master).
4. Write `.swarmforge/roles.tsv` (role, agent, worktree path, receive mode), `.swarmforge/tmux-socket` (project-private socket), install the `commit-msg` hook.
5. Start tmux sessions per role, launch the backend CLI in each worktree with the constitution + role prompt, start `handoffd`, start `pack_web` dashboard, print/open the **Dashboard:** URL (`.swarmforge/dashboard-url`), start `caffeinate`/`systemd-inhibit`.
6. Optional visible Terminal/Ghostty/iTerm/Windows-Terminal windows per role with a watchdog that reopens closed windows.

### Handoff protocol (the core mechanism)

Per-worktree state:
```
.swarmforge/handoffs/{outbox/{tmp/},sent/,failed/,inbox/{new,in_process,completed}/,audit_pending/}
```
Filename: `<priority>_<UTC-timestamp>_<seq>_from_<sender>_to_<r1_r2>.handoff` (sorted = queue order). Header block + generated body:

```text
id: 20260615T140531Z_000042_from_coder
from: coder
to: cleaner
recipient: cleaner
priority: 50
type: git_handoff
role: coder
task: task-1-cave-setup
commit: a1b2c3d9e8
created_at: … enqueued_at: … dequeued_at: … completed_at: …

Re-read your role and constitution.

merge_and_process.sh coder a1b2c3d9e8
```

Agent-facing loop (from `handoffs.prompt`):
- Send: commit → write `./tmp/handoff.txt` with only `type/to/priority/task` → `swarm_handoff.sh ./tmp/handoff.txt`. First call → `AUDIT_REQUIRED` (increments the card's audit counter); re-audit; identical second call queues. Commit abbrev must be exactly 10 hex chars resolving to one commit; helper fills it. Reserved headers rejected. Drafts in `/tmp` rejected (must be `./tmp/` in the worktree).
- Receive: on wake-up or restart run `ready_for_next.sh` → prints `NO_TASK`, or `TASK: <path>` + `FROM/TYPE/PRIORITY/TASK_NAME/PAYLOAD`, or `BATCH: <path>` + `BATCH_ITEM`s. For `git_handoff` it has already run `merge_and_process.sh <sender> <commit>` (a real `git merge`; the agent owns conflict resolution — "Parallel cards on one tree will conflict; that is expected"). `ready_for_next_task.bb` also stamps `dequeued_at` and `task_base_commit`, refuses ambiguous states (two in-process files), and blocks new work while the role has an un-audited outbound git handoff (`ready_for_next_guard.bb`).
- Finish: `done_with_current.sh` → `MAIL_WAITING` (then run `ready_for_next.sh` as a new turn) or `NO_TASK`.
- Two message types only: `git_handoff` and `note` (one line ≤80 chars; discouraged — "ask the operator with `pack_dashboard_request.sh clarify ./tmp/question.txt`" instead).
- `handoffd.bb`: polls outboxes, copies to each recipient's `inbox/new/`, adds `recipient`/`enqueued_at`, `tmux send-keys` the generic wake-up, moves original to `sent/` (transaction-like; no duplicate delivery on retry). It also updates the board (`pack_board!`), holds specifier handoffs pending dashboard approval (`should-hold?`, `pending-dir`), and detects the **terminal broadcast** (last role's `git_handoff` whose `to:` is every other role) which moves the card to Done; recipients of a terminal handoff merge and stop.
- Chain forwarding is mandatory: "Formatting-only, manifest-only, audit-only… churn still require a forward down the chain." Architect handoffs use `priority: 00` and do not interrupt current work.
- Commit hygiene: every commit gets `By <role>.` via hook; `--no-verify` forbidden.

### Pack cockpit (`pack_web.bb` + `dashboard.html`)

Header (title, live marker, New Task, Open master pane, Teardown) · **Attention** (spec Approve/Reject with Documents menu; clarification questions with a text box that injects the answer into that agent's pane) · **Board** (one swimlane per role + Done; cards are tasks; card shows the agent's latest "I'm …" status line; click for task body) · **Work Queue** (role, live/idle, six-bar activity thermometer, click to pop a live pane capture) · **Chat** to the master agent (durable request id injected as `[id] text`). Recent commits add persistent handoff audit tracking, per-document Attention reviews, retry of rejected handoffs, "block new work while handoffs are active."

### Constitution (shared articles, `main`)

- `engineering.prompt`: install latest `github.com/unclebob/{mutate4go,crap4go,dry4go | clj-mutate,crap4clj,dry4clj | mutate4java,crap4java,dry4java}` at startup; Speclj not `clojure.test`; Babashka preferred; separate testable modules from "environmentally unsuitable" ones; APS tools `gherkin-parser`, `ir-dry-checker`, `gherkin-mutator` via `swarm_tool.sh require|ensure`; run constitution tools one at a time with `--max-workers 4`; mutation is *differential against a manifest* (never `--mutate-all`, Gherkin `--level hard`, architect's final pass `--level soft`); "Do not invent project-local CRAP/DRY/mutation proxies."
- `workflow.prompt`: work only in your worktree; never inspect/diff/merge another branch unless named in a handoff; `./tmp/` not `/tmp`; commit byline; "If the expected git layout or assigned worktree is missing, stop and report."
- `handoffs.prompt`: the send/receive rules above.
- Pack `local-workflow.prompt` (four-pack): an architect wake-up doesn't interrupt; on an architect handoff every non-specifier role runs unit + acceptance tests, fixes, `done_with_current.sh`, and does *not* forward.

### Role prompts (four-pack excerpts)

- **specifier** (master): owns Gherkin per `unclebob/Acceptance-Pipeline-Specification`; five-phase feature workflow (write → prune params → `ir-dry-checker` → `Background` → commit + `git_handoff` to coder); "Do not ask for approval in the pane; the operator uses Attention"; when architect notifies completion, `ready_for_next.sh` (merges) then ask the user for the next feature.
- **coder**: ensure the APS pipeline exists (use the APS `gherkin-parser`, build a project-specific acceptance entrypoint generator/runtime/step handlers with regex-captured steps); "For each behavior slice, use TDD… tests that would fail for a plausible wrong implementation"; no mutation/CRAP/DRY (refactorer/architect own those); forward to refactorer, then `done_with_current.sh`.
- **refactorer**: behaviour-preserving cleanup, coverage, CRAP/DRY, mutation-site scans, property-test support.
- **architect**: UI/core separation, Dependency Rule, information hiding, local code quality; installs mutation + DRY + `gherkin-mutator`; runs mutation one file at a time; final sequence = language mutation → DRY → soft Gherkin mutation; batch-processes refactorer handoffs; terminal broadcast `to: specifier,coder,refactorer`.
- six-pack splits cleaner/architect/hardender/QA; QA "converts the specifier's QA procedures into executable scripts, runs final UI verification."

### Platoon (brainstorm, not built)

`platoon-brainstorm.md` (2026-08-24): a **Lieutenant** agent above several squads (each a pack instance in its own subdirectory) that brainstorms components with the operator, assigns pack types per component (two-pack for utilities, four-pack for business rules with Gherkin, six-pack for UI-heavy), enforces the Dependency Rule across components (interfaces owned by the higher-level component), integrates, and writes the system test procedure. Dashboard = squad rows of pack lanes.

## Workflow: end to end

1. `get-swarm-forge four-pack claude --dangerously-skip-permissions` in the project dir (composes `main` scripts + shared articles + pack overlay; currently known to clobber host `README.md`/`bb.edn`/`test/` — issue #1 in `issues.md`, fixed 2026-08-26). `./swarm`.
2. Dashboard opens. Operator clicks **New Task**, gives a stable name + text → card in the specifier lane; a `(New Task)` note is queued; specifier takes it with `ready_for_next.sh`.
3. **specifier** writes/prunes Gherkin features, commits, drafts `git_handoff to: coder task: <card name>`, `swarm_handoff.sh` → `AUDIT_REQUIRED` → re-audit → queue. handoffd *holds* it; operator sees **Approval** in Attention with the Documents menu; Approve delivers, Reject returns to specifier.
4. **coder** wakes, `ready_for_next.sh` merges the spec commit, builds/refreshes the acceptance pipeline, TDDs each slice, runs unit + generated acceptance tests, commits (`By coder.`), audited `git_handoff to: refactorer`, `done_with_current.sh`.
5. **refactorer** merges, cleans, coverage/CRAP/DRY/mutation-site scans, forwards to **architect** (batch mode: all equal-priority handoffs at once).
6. **architect** restructures, runs mutation → DRY → soft Gherkin mutation, commits; sends `priority: 00` `git_handoff` to coder+refactorer for follow-up if needed; when done sends the **terminal broadcast** `to: specifier,coder,refactorer` → each merges only → card moves to **Done**.
7. Specifier merges, asks the operator for the next feature. Any agent blocked on ambiguity posts a clarification; operator answers in Attention. **Teardown** kills tmux, handoffd, dashboard.

There is no CI, no PR, no external tracker: "merged" means every worktree has merged the final commit; the master checkout holds the result.

## Notable techniques worth stealing

- **Daemon-owned transport + durable inbox/outbox with state-as-directory** (`new/in_process/completed`), lifecycle timestamps in headers, priority-sorted filenames, transaction-like delivery. Restart-safe by construction: "On restart, run `ready_for_next.sh`."
- **Generic, lossy wake-ups** ("You have new handoff mail. If idle, run ready_for_next.sh.") that deliberately do not name the file, so the agent must process the queue in order and can ignore interrupts while busy.
- **Helper scripts as the only protocol surface**: agents write 4 headers; helper fills SHA (validated 10-hex, unambiguous), id, sequence (atomically locked), body. Removes an entire class of hallucinated git/tmux commands.
- **The two-call audit gate**: `AUDIT_REQUIRED` on first submit; only an *identical* second draft queues; any change resets. Cheap forcing function for self-review with a visible per-card audit counter.
- **Mandatory forward-regardless + terminal broadcast** = an explicit, machine-detectable "done" signal for a multi-agent chain, with the Done well filled only by the full recipient set.
- **`batch` receive mode** for review-type roles: collapse N equal-priority handoffs into one review pass.
- **Approval hold for the spec boundary** and **`clarify` requests to the human** instead of agent-to-agent chatter; "Do not ask in the pane."
- **Constitution layering with filename law**: shared articles come from `main`, packs only add `local-*.prompt`; `constitution.prompt` "takes precedence over article files" and says just "read and obey every file in articles/."
- **Role byline commit hook** (`By coder.`) — trivially attributable git history across agents.
- **Per-worktree copies of scripts on `PATH`** so agents never depend on the master checkout.
- **Discipline content**: differential mutation testing against a manifest, Gherkin that is itself mutation-tested (`gherkin-mutator`), "tests that would fail for a plausible wrong implementation," separate testable modules from IO shells, tool runs serialized with worker limits, "judge by project-local tools, do not invent proxies."
- **Sleep inhibitor + project-private tmux socket + window watchdog** — small operational details that matter for overnight runs.
- **`AGENTS.md`: don't unit-test prompt wording** — treat prompts as policy, not code.

## Weaknesses / open questions / risks

- **No license.** Cannot be legally vendored or redistributed until Uncle Bob adds one; usable only as a reference design.
- **Zero sandboxing.** Agents run with `--yolo` / `--dangerously-skip-permissions` directly on the host in tmux, with full network and credentials. Isolation is only git-worktree isolation from each other.
- **Interactive TUIs driven by `tmux send-keys`** are brittle (copy-mode, prompts, CLI UI changes); much of the recent commit churn is pane/scrollback/heat fixes. Headless `-p` mode is not used.
- **Serial pipeline; throughput bounded by the slowest role**; the architect/hardener steps (mutation testing one file at a time) can be very long. "Time is of the essence during mutation work" appears in the prompt because it is a known problem.
- **Merge conflicts are expected and pushed onto agents** ("Parallel cards on one tree will conflict; that is expected").
- **Clojure/Babashka/Speclj-centric** tooling and Uncle Bob's own CRAP/DRY/mutation tools (Go/Clojure/Java only); TypeScript/Python projects get much less of the constitution's value.
- **Single-maintainer, rapidly changing**, docs say `main` is "documentary"; packs are branches (acknowledged as wrong — `issues.md` proposes `packs/<name>/` directories).
- **Heavy startup cost**: every role installs the latest tools from GitHub at startup, every session.
- No trace/observability beyond tmux scrollback, handoff headers, and the dashboard's live pane captures; no token/cost accounting.
- Unclear how well non-Codex backends are exercised — pack confs default to `codex --yolo`; Claude support is via `--dangerously-skip-permissions` pass-through.

## Fit for our agentic stack

- **Adopt the handoff protocol design** (durable inbox/outbox, helper scripts as the only surface, validated git handoffs pointing at commits, terminal broadcast, batch mode) as the inter-agent messaging layer in our factory — but implement it over headless `claude -p --resume <session>` invocations driven by an orchestrator rather than tmux keystrokes. The file layout and header semantics port directly.
- **Adopt the audit gate and the approval hold** as explicit steps in our chain: an implementer must submit twice with an unchanged diff/SHA; spec → build transitions wait for a human Approve in a dashboard or PR comment.
- **Adopt the constitution structure** for our CLAUDE.md/skills: shared "law" articles vs project `local-*` additions with a filename rule; role prompts as separate files; byline commit hook (Claude Code `PreToolUse`/`commit-msg` hook).
- **Steal the discipline content selectively**: TDD "tests that fail for a plausible wrong implementation," testable/IO separation, mutation testing as a hardening role (use Stryker/mutmut for TS/Python instead of Uncle Bob's tools), Gherkin acceptance pipeline only if we want BDD.
- **Map roles to Claude Code subagents/skills** rather than six always-on TUIs: specifier/coder/refactorer/architect as prompts run in Sandcastle-style worktrees with SSSF-style gates; keep the *chain and forwarding rules* from SwarmForge.
- **Skip**: tmux/terminal adapters, window watchdog, the pack-as-branch distribution, Babashka toolchain, Codex `--yolo` defaults.
- **Watch**: the Platoon/Lieutenant concept (hierarchical packs per component with the Dependency Rule enforced across squads) — a plausible shape for multi-repo/multi-component factories.

## Related resources mentioned

- `unclebob/Acceptance-Pipeline-Specification` — portable Gherkin acceptance pipeline: `gherkin-parser`, `ir-dry-checker`, `gherkin-mutator` (176 stars, active Aug 2026). https://github.com/unclebob/Acceptance-Pipeline-Specification
- Uncle Bob's per-language tools: `clj-mutate`, `crap4clj`, `dry4clj`, `mutate4go`, `crap4go`, `dry4go`, `mutate4java`, `crap4java`, `dry4java` (all under https://github.com/unclebob/). CRAP = Change Risk Anti-Patterns metric (complexity × uncovered).
- Clean Coders "Clean AI: Agentic Discipline" video series (Episode 6 covers the six-pack) — https://cleancoders.com/episode/agentic-discipline-6
- Uncle Bob on X: fork from Justin — https://x.com/unclebobmartin/status/2046350013706523093 ; six-pack run report — https://x.com/unclebobmartin/status/2062557016086786435 ; "I did this in one day with a six-pack" — https://x.com/unclebobmartin/status/2080833968962748911
- Write-ups: https://pyshine.com/SwarmForge-Disciplined-AI-Agent-Orchestration-tmux/ ; https://moclaw.ai/blog/what-is-swarm-forge ; https://deepwiki.com/unclebob/swarm-forge
- Speclj (Clojure BDD test framework), Cloverage, Babashka.
- `platoon-brainstorm.md` in-repo — hierarchical "Lieutenant over squads" design.
- Justin Martin's original tmux agent-control repo (not located; worth finding).

## Key quotes / references

- README: "A disciplined tmux-based agent orchestration platform that turns swarms of AI agents into reliable, professional software engineers."
- README: "Agents do not send tmux messages directly. The launcher starts `handoffd.bb`, which owns tmux socket access, watches each agent outbox, copies validated handoff files into recipient inboxes, and sends only generic wake-up notifications."
- README: "The first valid Git handoff call returns `AUDIT_REQUIRED` … The sender must re-read the complete task and referenced sources, trace every requirement and constraint to role-appropriate work and evidence, examine boundaries and failure cases, fix every finding, rerun applicable checks, and repeat the audit. Only an unchanged second call queues the handoff."
- `handoff-protocol.md`: "Tmux wake-ups are intentionally lossy. They only prompt an idle agent to check its durable inbox."
- `handoff-protocol.md`: "Intermediate roles in a pack pipeline must always forward a `git_handoff` to the next role in the chain after completing the inbound task, regardless of what changed."
- `engineering.prompt`: "Separate testable modules from environmentally unsuitable modules that open GUIs, depend on external devices… Maximize testable code and minimize the unsuitable boundary." / "Do not invent project-local CRAP, DRY, mutation, or coverage proxies."
- `coder.prompt`: "First write focused unit tests that express the requested observable behavior and would fail for a plausible wrong implementation."
- `architect.prompt`: "Use it to cover the uncovered, and kill survivors."
- `AGENTS.md`: "Do not test the text of prompts with an automated unit or acceptance test… Prompt wording is not production behavior to pin."
- Uncle Bob (X, 2062557016086786435): "Outcome was a usable application with a solid architecture and overloaded with unit tests, acceptance tests, and QA tests."
- README banner: "Do not spend any money on a bankrbot SWARM token." (a scam token was launched using the project's name)

### Gaps
- X posts could not be fetched directly (402); quotes come from search snippets.
- Read `swarmforge.bb`, `handoffd.bb`, `swarm_handoff.bb`, `pack_web.bb` only via grep/skim; six-pack and two-pack branch prompts not fetched (four-pack was).
- Justin Martin's original repo not identified.
