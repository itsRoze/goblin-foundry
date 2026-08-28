# Goblin Foundry — Blueprint v1

**Date:** 2026-08-27 (rev 3)
**Status:** Architectural blueprint for v1. Slice-level detail is deliberately absent; each slice is planned with `/grill-me` when it starts.
**Inputs:** `research/SYNTHESIS.html`, `research/CRITIQUE-AND-PROPOSED-DIRECTION.md`, `research/factories/goblin-factory-v0-postmortem.md`, `TEMP-BLUEPRINT-v1-REVIEW.md` (rev 2), `CONTEXT.md` + `docs/adr/0001–0006` + `docs/specs/S1-tracker-core.md` (rev 3: S1 decisions folded back), `research/subway-reader/*` (reference only).

## 1. What v1 is

A solo, open-source software factory with two halves built in order:

1. **An owned ticket-management system** — the durable product/design memory and human control surface for a portfolio of apps. Built first, used by the human before any automation exists.
2. **A controller** that takes an approved ticket, runs one **pi** session in one **cloud sandbox**, verifies the result with a repository-owned command, and opens a human-reviewed PR.

The first product built through it is **Subway Reader**, an offline-first e-ink RSS reader for Android. Subway Reader enters after the tracker exists, as a freshly planned project created through the tracker. The legacy breakdown in `research/subway-reader/` is reference material, not the plan.

v1 is a new codebase. Nothing is reused from `~/dev/factory` except contracts, prompts, and lessons (§8).

### Working principle

> Agents produce candidates. Deterministic code enforces boundaries. Evidence informs trust. The human owns intent and irreversible decisions.

### Non-goals for v1

Multi-user, multi-provider, unattended merging, LLM review chains, mutation gates, stacked PRs, merge queues, model routing, scheduled maintenance agents, benchmark infrastructure, GitHub Issues sync, a Linear-style board. §9 lists each with its evidence.

## 2. Principles

| # | Principle | Evidence |
|---|---|---|
| P1 | **Code owns the loop; agents are bounded nodes returning candidates.** Sequencing, claims, dispositions, gates, transitions, commits and merges are controller code. The agent never owns commit/push semantics or decides completion. | SSSF, bmad-loop, Stripe Blueprints, Uber AutoCover converge here; v0's agent-decided "done" and reviewer loop are where failures clustered. |
| P2 | **Build in slices, tracker first.** A slice is usable by the human before the next starts. No table, field, or process exists ahead of the slice that needs it. | v0: 18 tables / 163 columns, five built ahead of use; M0 thin slice worked (4/6), M1 five-features-at-once failed (20%). |
| P3 | **Fresh session per ticket; same session for bounded corrections; never across a model change.** | Ralph/afk/GSD/QRSPI/bmad-loop vs SSSF/Sandcastle (synthesis B §3). v0 builder_fix succeeded 5/9 by resuming. |
| P4 | **The sandbox provides execution isolation; the controller enforces authority.** pi runs unrestricted inside a disposable VM holding minimum credentials, egress, repo scope and lifetime. Post-run policy, tamper detection and every external write are enforced by the controller or a trusted wrapper, never by host heuristics on the agent's tool calls. | v0 path guard: 66 breaches, 19/29 false positives. Sandboxes delete ~600 lines of v0 isolation code. |
| P5 | **Deterministic failures block; semantic concerns route.** Build/test/scope/protected-artifact failures block. An LLM concern routes to a human or revokes unattended eligibility; it never rejects alone. Route-to-human results are recorded so a future reviewer can be scored. | Critique §1; uReview; v0 reviewer 1/46. |
| P6 | **Protected verifier by default, hidden by class.** Workers may read acceptance artifacts; modification is detected and rejected (v1) or prevented (later). Hidden only for regression fixes, external contracts, security invariants, migrations, and factory self-evaluation. | Critique §2; fusion-harness; 80% of agent-written tests carry no oracle. |
| P7 | **Planning is a conversation, not a phase.** A ticket is ready when no unresolved question could materially change scope, acceptance criteria, or an irreversible decision; known assumptions and deferred questions are allowed. Workers never park waiting on a human; a run that must ask ends and returns the ticket. | v0: 152 questions, 896 min blocked inside worker phases. |
| P8 | **Humans re-arm.** A failed run leaves the ticket in `needs_human` with the reason. Lease expiry never silently makes a ticket runnable. Reconciliation of the *same* attempt may be automatic; a *new* attempt requires a human. | v0: 12,357-iteration claim loop, FAC-13 26 runs / 3 successes, 11 `base_conflict`. |
| P9 | **One metered provider, dollar-capped per run.** | v0: 30 of 94 runs died on subscription windows. |
| P10 | **Measure what survived, not what shipped.** | Faros: merges up, incidents/PR +243%. |
| P11 | **Reversible order.** Prefer the option replaceable behind a contract over the one that dictates schema. | Zero: 11 of 45 v0 lessons, three databases before one ticket ran. |
| P12 | **Write LESSONS.md and DECISIONS.md as you go, union-merged.** | The only reason the post-mortem has numbers. |

## 3. System shape

```
 human ── /grill-me, planning conversation, approvals, re-arm, review ──┐
                                                                        ▼
 ┌────────────────────── controller process (one) + authoritative store ──────────────────────┐
 │  TRACKER                          CONTROLLER                        EVIDENCE               │
 │  App → Project → Ticket           claim (lease) · input snapshot ·   artifacts (digests)    │
 │  design revisions · deps          dispatch · gate results ·          gate_result            │
 │  lifecycle FSM · authority        disposition · integration ·        run_result             │
 │  GitHub projection                reconciliation on restart          run_event              │
 │             ▲                              │                                                │
 │   typed API │ (zod)          provider contract                                              │
 └─────────────┼──────────────────────────────┼────────────────────────────────────────────────┘
               │                              ▼
      web GUI · gf CLI          ┌──────────── sandbox (per run) ───────────┐
      / task-scoped             │  trusted wrapper (controller code)       │
        agent capability        │    ├─ pi --mode rpc  (agent, unrestricted)│
                                │    ├─ make verify → verify.json          │
                                │    └─ tamper check · commit · push ──────┼──▶ GitHub: agent/<ticket>
                                │  repo clone @ base_sha, warm caches      │          PR · CI · review
                                └──────────────────────────────────────────┘          human merge
                                                                                        │
                                       GitHub state projection (poll + optional webhook)◀┘
```

### 3.1 Tracker

The durable memory and control surface for a solo portfolio of apps, and the factory's queue. A first-class product, not queue plumbing.

**Authority.** Goblin Foundry owns apps, projects, designs (as revisions), tickets, dependencies, runs and workflow state. GitHub owns repositories, commits, checks, PRs, reviews and merge state. Selected GitHub state is *projected* into the tracker (§3.6); tickets are never mirrored into GitHub Issues.

**Domain (grows by slice).** S1 (per ADR-0006): `App`, `Project` (with a markdown design), `Ticket` (description, markdown design, `simple` flag; may belong to no app or project), `TicketDependency`, `Event` (audit log), `Setting` (key prefix). Later slices add `Run`, `Artifact`, `GateResult`, `RunResult`, `RunEvent` as §3.5 needs them; labels, milestones, priority, lane, scope, acceptance and budget fields arrive with the slice that reads them (lane/scope/acceptance/budget: S2; claim order, `needs_human`: S5).

**Designs.** Markdown stored **in the tracker** as a `design` column on Project and on Ticket, edited in place (ADR-0005; supersedes the earlier "markdown in the app repository, `path + sha`" rule). Reasons: tickets can exist without a repository, and design files cluttered the product repo. History is the `event` log (prior/new bodies); no revision table or sha in S1. The one hard requirement — a run is judged against the design it started with — is met by copying the text into the S2 input snapshot at claim time. An implementation PR that wants a design change proposes a tracker edit; it takes effect only after the human accepts it.

**Lifecycle (ADR-0003):**

```
backlog ⇄ todo ⇄ planning ──(human approves; needs app + description + design unless simple)──▶ ready
ready ──(human by hand in S1; controller lease from S5)──▶ building
building ──(PR exists)─────────────────────────────────▶ review
building ──(stop)──────────────────────────────────────▶ ready
ready ──(unapprove)────────────────────────────────────▶ planning
review ──(ship)────────────────────────────────────────▶ done
any but done ──(human)─────────────────────────────────▶ cancelled ──(restore)──▶ backlog
S5 adds: building ──(question · semantic route · terminal failure · lease expiry)──▶ needs_human ──(human re-arms)──▶ ready
```

Names per ADR-0003 (the earlier `draft/running/ready_for_review` became `backlog·todo·planning / building / review`; authority rules unchanged). Rules: status is workflow state only — CI state and PR review state are separate observed fields. Blocked is derived (an open blocker; `cancelled` blockers do not block), never a status. Editing fields never changes status. Agents may propose results and transitions; they cannot approve, re-arm, change canonical status, or mark shipped. A reaper that finds an expired lease records a run failure and routes to `needs_human`; it never re-queues.

**Readiness.** `ready` ∧ no open blocker (S1) ∧ not leased ∧ within concurrency and risk limits (S5). Computed on read, never stored; `GET /frontier`.

**Lease.** The smallest correct atomic lease: `run_id, ticket_id, lease_owner, leased_at, heartbeat_at, expires_at, attempt`. Semantics (atomic acquisition, heartbeat, expiry → reconciliation) are the contract; the implementation is an atomic conditional update on one row, which SQLite and a Durable Object both honour (ADR-0001). No distributed queue.

**Surface.** A typed HTTP API (Hono + zod) is the one audited write path; the web GUI, the `gf` CLI, and later the agent capability are all clients of it (ADR-0004). Transitions are named intent endpoints (`POST /tickets/:key/approve|start|ship|…`), never a writable `status` field; errors are `problem+json` (`422` zod issues, `409 {owner, hint}` for refused transitions). The GUI ships in S1 — kanban as home with drag-and-drop between statuses, Ticket, Project and App views, a markdown editor, a per-project dependency graph, URL-parameter filters — because a tracker the human cannot operate by hand is not usable (P2). Drop targets and refusal text derive from the transition table so controller-owned edges become refusals in S5 with no UI change. The `gf` CLI is a thin JSON wrapper so the planning skill has a reliable tool; it is not a second write path. Every mutation records actor (`human` | `agent`; `controller` later), kind, prior, new, timestamp.

**Agent access is task-scoped and intent-level**, not generic record mutation:

```
factory app show <id>
factory project context <id>
factory ticket show <id> --approved-revision
factory ticket ready
factory ticket propose <id> --result <file>
factory run heartbeat <id>
factory run complete <id> --envelope <file>
```

A worker's capability covers its ticket only. It cannot browse unrelated apps, approve its own design, re-arm, or mark work shipped.

**Storage (ADR-0001).** One Bun process, one SQLite file (`~/.goblin-foundry/foundry.db`, WAL) accessed only through Drizzle's async API behind a single `db.ts` seam, so a later move to a Cloudflare SQLite-backed Durable Object hosting the same Hono app is a driver swap, not a rewrite. Postgres rejected (second service and credentials for a single writer; closes the Cloudflare path). Backups: `gf backup` (`VACUUM INTO` a dated copy) nightly; Litestream to R2 once the process leaves the laptop. No Zero, no sync engine (P11); the GUI uses plain fetch with a query cache, optimistic transitions rolled back on `409`, and a 5 s poll on the board.

**Keys (ADR-0002).** Tickets have one global serial number shown as `<prefix>-<n>` (`GF-12`), prefix set once per installation; never reused, never changes when a ticket moves between apps or projects. Apps and projects use opaque ids with mutable names.

### 3.2 Run inputs: immutable approved snapshot

At claim time the controller records an immutable input snapshot and every gate evaluates against it, so an implementation is never judged against a specification it changed during the run:

```
app_id · project_id · ticket_id · ticket_revision
project_design (text, copied) · ticket_description (text, copied) · ticket_design (text, copied)
acceptance_revision · declared_scope · risk_lane
factory_config_sha · repository_base_sha
```

**Repository policy** (per repo, ~10 fields): default model and effort; budget/turn/time ceilings; verification command; protected paths and artifact classes; default max diff; egress rules; integration settings.
**Ticket/run input** (per approved ticket revision): scope; acceptance criteria; risk lane; dependency snapshot; budget override within ceilings; human-approved exceptional paths.
The controller compiles both into an **effective run policy** stored with the run.

### 3.3 Controller

A small TypeScript loop in the same process as the tracker. The tracker is truth; the controller is recoverable from it (§3.7).

```
human approves ticket → ready
controller acquires lease (ready → building), records input snapshot + effective policy
provider.create(image, base_sha, per-run credentials, egress, ttl)
trusted wrapper starts pi --mode rpc, fresh session, ticket snapshot + design as prompt
agent implements one vertical slice (edits only; never commits)
wrapper runs `make verify` → verify.json; controller derives gate_result
disposition:
  correct_same_session  — verification failure, budget/time/progress permitting, failure not repeating unchanged
  retry_infrastructure  — provider/harness failure; does not consume a correction
  return_to_human       — semantic route, blocked, scope question, repeated protected-artifact violation
  terminal              — budget/turn/usage exhaustion, unrecoverable
wrapper: tamper check → commit with provenance → push agent/<ticket-id>
controller observes pushed sha (idempotent by run_id) → opens PR with evidence → destroys sandbox
human reviews (L3/L4; ticket in `review`), squash-merges
GitHub projection updates → ticket done → dependents unblocked → design reconciliation recorded
```

**Phase.** v1 has one agent phase, `implement` ("build" is reserved for compilation and build-gate failures). A second phase is added only when `implement` is stable enough to build on *and* outcome data identifies a problem a separate phase is likely to solve.

**Corrections.** Two is a maximum, not a rule: governed by disposition, total cost, wall time and progress; stop early when the same normalized failure repeats unchanged.

**Backstops kept from v0:** named halt reasons that are never retried (`budget_exhausted`, `turn_limit`, `usage_limit`, `no_credit`), rate breaker, stalled-run sweep on every tick routing to `needs_human`.

### 3.4 Results and evidence

Two distinct contracts. The agent's envelope is optional — many failures mean no valid envelope exists. The controller's run result is authoritative for every terminal run.

```ts
// Returned by the agent only when the pi interaction completes enough to produce one.
type AgentEnvelope = {
  status: "completed" | "blocked";
  summary: string;
  changedFiles: string[];
  evidence: EvidenceClaim[];      // assertions, not proof
  handoff?: string;
  blockingReason?: string;
};

// Owned by the controller. Present for every terminal run.
type RunFailureOrigin = "provider" | "harness" | "protocol" | "verification" | "semantic" | "integration";
type RunDisposition   = "correct_same_session" | "return_to_human" | "retry_infrastructure" | "terminal";
type RunResult = {
  outcome: "succeeded" | "failed";
  failureCode?: string;           // stable, enumerated
  origin?: RunFailureOrigin;
  disposition?: RunDisposition;   // independent of origin
  detail: string;
  artifacts: ArtifactRef[];
};
```

Evidence is modelled as distinct concepts even where S1–S5 store them in few tables:

- `evidence_claim` — what the agent says it did or verified;
- `artifact` — immutable content or URI, digest, producer, type, retention (verify.json, logs, patch, screenshots, session JSONL, provider usage);
- `gate_result` — the controller's interpretation of a verification command;
- `run_event` — operational state transitions;
- `run_result` — authoritative terminal outcome.

Envelope transport: fenced JSON at the end of the final message, `tryJson` fallback, one re-prompt (pi has no structured-output mode; v0's SDK mode returned null 29 times).

### 3.5 Worker runtime — pi, and the trusted wrapper

Inside the sandbox two things run with different trust:

- **The trusted wrapper** is controller code: starts and supervises pi, runs verification, performs the tamper check, commits with controller-supplied provenance, pushes the namespaced branch, exports artifacts. It holds the per-run GitHub token; the agent process does not.
- **pi** (`--mode rpc`, JSONL on stdio, fresh session) is the agent. It edits the workspace and runs commands freely. Its factory extension provides telemetry (provider hooks: cost, budget kill-switch), `tool_result` scrubbing, `appendEntry` for run id / base sha, and a `tool_call` policy that is *advisory friction*, not the security boundary (P4).

Skills follow the Agent Skills spec (portable to Claude Code) and are loaded explicitly with `--skill` in workers. pi is pinned in the image (`ARG PI_VERSION`); the session JSONL is exported as an artifact. Starting point: v0 `apps/worker/src/harness/pi.ts`.

### 3.6 Sandbox, git ownership, and GitHub projection

**Provider contract** — small, capabilities explicit: `create(image, opts) → handle`, `exec`, `putFile/getFile`, `destroy`, `capabilities()` (snapshot, fork, pause, proxy-auth, max ttl). One provider in v1, chosen in S4 by measurement.

**Credentials.** Provider-brokered where available; otherwise a capped, revocable per-run LLM key and a per-run GitHub App installation token scoped to the one repository, held by the wrapper. Never the factory's own secrets. The bot identity cannot approve its own PR.

**Egress.** Allowlist: LLM host, GitHub, package registries (and Maven/Google for Android). Git over HTTPS.

**Image.** Repo toolchain + pinned pi + skills + warmed dependency caches, rebuilt on a schedule. Cold start is the adoption lever.

**Git ownership (v1 = "worker transports, controller integrates").** The agent never commits. The trusted wrapper, after final verification and tamper check, commits with controller-supplied trailers (`Factory-Ticket`, `Factory-Run`, `Factory-Model`, `Factory-Base`) and pushes `agent/<ticket-id>`. The controller observes the pushed sha and opens the PR; every external operation is idempotent on `run_id`. If the chosen provider cannot hold a safe per-run token, fall back to controller-pull: wrapper exports a bundle + evidence, controller commits and pushes. Either way the agent owns nothing past the working tree.

**Snapshots** at phase boundaries only: task start, implementation complete, after each correction, final tree. Tree hash stored on the run.

**GitHub projection.** Stored per ticket/run: `pr_url/pr_number, head_sha, ci_state, review_state, merged_at, merge_sha, last_observed_at`. Updated by periodic reconciliation, with an optional webhook endpoint as an accelerator — webhook delivery is never part of correctness. This is a projection of an integration artifact, not a second ticket source.

**Integration path.** One ticket → one branch → one PR → human approval → squash merge, trailers copied into the squash message via PR template and checked by CI. TTL sweeper for stale branches.

### 3.7 Restart reconciliation

On startup the controller reconciles every non-terminal run against provider and GitHub state before doing anything else:

- sandbox exists and pi is live → reattach and continue observing;
- sandbox exists, process terminal → collect artifacts, classify, record `run_result`;
- sandbox gone → record provider/harness failure, route to `needs_human`;
- branch or PR already exists → adopt it idempotently; never create a second;
- lease expired with ambiguous external state → quarantine in `needs_human`; never rerun automatically.

### 3.8 Verification and protected artifacts

**One repo-owned command** (`make verify` or equivalent) emits `verify.json`; the controller reads only that. Tiers: `fast` (inner loop), `full` (pre-PR). `deep` (mutation, acceptance-data mutation, property sweeps) is a scheduled diagnostic, not a gate.

**Blocking, deterministic:** build, format/lint/static analysis, unit and integration tests, files touched ⊆ declared scope, max diff, exact base and head tree verified, verification performed on the clean proposed tree.
**Telemetry first, promoted only by outcome data:** read-before-edit, structural metrics.

**Protected artifacts — enforcement is named, not assumed:**

- *Detected after execution (v1 default):* the controller compares approved digests of protected paths (fixtures, selected regression tests, verification config) against the final tree and rejects any modification — this is tamper detection, not filesystem protection. If the agent needs a protected verifier in its inner loop, the wrapper verifies its digest immediately before every execution.
- *Prevented during execution (later):* read-only mount or a second OS user without escalation.
- *Hidden:* never enters the sandbox; executed by the controller or CI. Reserved for the classes in P6.

**UI evidence** (screenshots/recordings) attaches to the PR for human judgment, never as automatic proof.

**Android constraint.** Emulator tests need KVM, which Firecracker microVM providers lack. In v1 the sandbox runs JVM-side verification (pure-Kotlin module tests, Room/migration tests, lint, `assembleDebug`); emulator smoke tests run in KVM-enabled GitHub Actions and report to the PR. This constrains provider choice and image design; it does not shape the tracker or build order.

### 3.9 Review lanes

- **L3:** human reads the full diff. **L4:** human reads ticket, evidence, summary and high-risk files, spot-checks the diff.
- **L5** does not exist in v1; earned per task class from outcome data. Dependency updates are not automatically safe.
- Lane is set at intake, recorded on the run and PR, so defect rate per lane is measurable. Semantic route-to-human results are recorded for the same reason.

### 3.10 Outcomes

Per accepted ticket: success without human correction; human correction and review minutes; total cost; wall time; retry count by failure origin and disposition; revert or corrective follow-up within 14 and 30 days; changed lines and files; verification duration and flaky-check rate; sandbox startup and idle time. Structural metrics are observations. Events are written in batches; no transcript mirror (v0: 80 MB unread). Budgets calibrated from v0: implement ≈ $4–5 / 14 min / ~80 turns.

## 4. Human workflow

**Planning (terminal, with skills, before any run):** idea → app and project in the tracker → project and ticket designs written into the tracker (markdown, via the GUI or the planning skill over `gf`) → vertical-slice tickets with dependencies, declared scope and acceptance criteria → risk lane (S2) → approval. Agent-created tickets land in `planning`, never `ready`; approval is always the human's. Mattpocock's day-shift chain is adopted as-is; QRSPI's instruction-budget rule applies (~200-line design doc, small prompts).

**Execution:** the controller claims approved, unblocked tickets and produces PRs with evidence; anything needing a human ends the run.

**Attention view:** everything waiting on the human — PRs to review, tickets in `needs_human` with reasons, design reconciliations to accept — visible without reading raw logs (v0 `inbox.ts` derivation).

## 5. First proving product: Subway Reader

Offline-first RSS/Atom reader for Boox e-ink (Android), iPhone later. Mockups: the linked "Subway Reader — V1 Screens" artifact. Legacy design and tickets in `research/subway-reader/` are inputs to a **fresh planning conversation run through the tracker after S1**; they are not commitments.

Carried forward as architecture, not tickets: a pure-Kotlin JVM core module with no Android imports (the seam that lets most logic verify in any sandbox without an emulator) under a Compose/WorkManager Android app. Validation: Gradle build, ktlint/detekt, core tests on curated feed fixtures (protected), Room migration tests, repository tests with networking disabled, emulator smoke tests in CI, screenshots as evidence. Slices are cut so each changes the core and exposes a tappable surface on the device.

## 6. Build order

Each slice ends with something the human uses. Contents are planned with `/grill-me` at slice start; this fixes order and exit criteria only.

| Slice | Delivers | Exit criterion |
|---|---|---|
| S1 | Tracker core (spec: `docs/specs/S1-tracker-core.md`): App, Project, Ticket (description, design, `simple`), Dependency, event log, eight-status transition table, Hono + zod API, `gf` CLI, GUI (kanban home with drag-and-drop and filters, Ticket, Project, App, markdown editor, dependency graph) | A fresh Subway Reader MVP project is created in the GUI; an agent-assisted planning conversation (Claude Code skill over `gf`) produces approved tickets with dependencies through the API; tickets can be dragged between statuses; the ready frontier is correct on screen |
| S2 | Approved input snapshot, agent envelope, controller run result, failure taxonomy and disposition | A hand-run pi session consumes one approved ticket snapshot; successful, malformed, blocked and timed-out results classify correctly |
| S3 | Repository verification contract | A representative repository emits valid `verify.json`; tampering and failure cases classify correctly |
| S4 | Provider bakeoff, one production adapter, warm image, controller deployment target | One provider selected from a bounded experiment; warm-start, cost, artifact export, credentials, teardown and restart behaviour measured |
| S5 | Controller execution and integration loop, restart reconciliation | The first newly approved Subway Reader implementation ticket becomes a human-reviewed PR and is merged through the loop |
| S6 | Outcome telemetry and attention view | Ten real tickets have authoritative run/outcome rows; every attention state is visible without raw logs |
| S7+ | Decided from S6 data: second phase, L5 for a task class, prevented/hidden verifier classes, a non-blocking review pass | Each gated on `implement` stability and a measured problem |

Before S5 every step is driven by hand until it is boring. The factory onboards itself as a project only after a non-factory repo has gone through cleanly.

## 7. Decision order

1. ~~Minimum tracker entities, fields, design representation, lifecycle~~ — decided (CONTEXT.md, ADR-0002, 0003, 0005; spec `docs/specs/S1-tracker-core.md`).
2. ~~Human vs agent transition authority~~ — decided (ADR-0003: every edge names an owner; all S1 edges human).
3. ~~SQLite vs Postgres~~ — decided: SQLite via Drizzle, one Bun process, Cloudflare-compatible by construction (ADR-0001).
4. Fresh Subway Reader MVP planning through the new tracker.
5. Immutable approved ticket/run-input schema.
6. Agent envelope + controller run result, taxonomy, disposition.
7. Verification and protected-artifact enforcement contract.
8. Worker/controller git ownership confirmation and artifact transport for the chosen provider.
9. Provider bakeoff and controller deployment/restart behaviour.
10. First product ticket through the complete loop.

## 8. Salvage from v0 (contracts and prompts, not systems)

`packages/schema/src/types.ts` (envelope base, gate check/report, status kinds), `trigger.ts`, the `run/phase/event` shape from `001_init.sql` (trimmed), lease semantics of `claim()`, `halt.ts`, `breaker.ts`, `reaper.ts`, trailer commit logic, mechanical gates (`tests_pass`, `diff_matches_claims`), `harness/pi.ts`, `questions.ts` (post-v1), `/plan` skill and prompts, cursor SSE stream, `inbox.ts`, `docs/LESSONS.md`, `docs/DECISIONS.md`. Real v0 is branch `m1` at `~/.herdr/worktrees/factory/m1`; `pg_dump` its database before it goes.

## 9. Explicitly deferred

| Deferred | Why |
|---|---|
| Beads or GitHub Issues sync | Two sources of truth before one is needed |
| Second sandbox provider | Portability is earned by evidence |
| Stacked PRs, merge queue, repair bots | GitHub FIFO suffices below ~20 PRs/hour |
| Validator-agent-authored gates | Needs acceptance criteria good enough to script; v1 uses human criteria + tests |
| LLM review chain | v0: 1/46, half the spend; trusted only as a graded chain at Uber volume |
| Mutation as a blocking gate | Diagnostic until runtime, equivalent mutants and false positives are measured |
| Hidden acceptance for every task | Excessive for exploratory and UI work |
| Tool-call-level git snapshots | Session JSONL has it; phase-level recovery points suffice |
| Prevented (mount/user) protection | Tamper detection suffices until an incident says otherwise |
| Multiple GitHub App identities | One bot that cannot self-approve is enough for one human |
| `WEATHER.md` model routing | One model per role until $/accepted ticket is measured |
| L5 unattended merging | Earned per task class from S6 data |
| Scheduled cleanup agents | No slop trajectory data yet |
| Private benchmark runs | Harness CI for a one-phase harness |
| Zero / sync engine | P11; REST + polling/SSE covers one user |
| Configurable workflows, custom statuses, comments/mentions, notifications, saved views, real-time collaboration, label/milestone lifecycle, plugins, extra import/export formats | Tracker stays a planning/control surface until the planning session proves a need |

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Tracker becomes a Linear clone before the factory runs | S1 GUI is limited to the four mockup screens with empty run/evidence tiles; no sync engine; §9 tracker deferrals |
| R2 | Gradle cold start dominates run cost | Warm image with dependency cache; measured in S4 before provider choice |
| R3 | Android emulator can't run in the chosen sandbox | JVM verification in sandbox, emulator in KVM CI (§3.8) |
| R4 | Model tool-schema drift on pi's strict schemas | Pin pi; re-run S2's hand session per model release |
| R5 | Provider churn | Provider contract; pinned image; nothing provider-specific in the controller |
| R6 | Dogfooding too early | Factory onboards itself only after Subway Reader has shipped tickets |
| R7 | Correction loop burns budget on non-verification failures | Disposition independent of origin; infrastructure failures don't consume corrections; humans re-arm |
| R8 | Agent tampers with protected artifacts | Digest check before verification and before commit; repeated violation → `return_to_human` |
| R9 | Controller crash mid-run duplicates work or orphans sandboxes | §3.7 reconciliation; idempotency keys on `run_id`; quarantine on ambiguity |
