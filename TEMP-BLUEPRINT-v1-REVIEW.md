# Temporary review of `BLUEPRINT-v1.md`

**Date:** 2026-08-26  
**Purpose:** Handoff to the agent revising the blueprint  
**Review frame:** Goblin Foundry's owned ticket-management system is intentionally built first. The legacy Subway Reader tickets under `research/subway-reader/` are reference material, not the final MVP plan. After the tracker exists, an agent-assisted planning conversation will create a fresh Subway Reader project design and vertical-slice backlog in the tracker.

## Overall verdict

The blueprint is pointed in the right direction and is close to being actionable. Its most important decision is sound: the owned tracker is not incidental queue plumbing. It is the durable product/design memory and human control surface for a solo portfolio of apps, so building it before dispatch automation is intentional.

The sequence should remain:

1. Build the smallest useful owned ticket-management system.
2. Use it to create and approve a fresh Subway Reader MVP plan and tickets.
3. Add the agent execution contracts and verification seam.
4. Add one sandbox provider and the controller loop.
5. Prove one newly created Subway Reader ticket end to end.

Do not revise the blueprint around the exact legacy `SR-*` ticket contents. Replace references that make those identifiers normative with language such as “the first approved Subway Reader implementation ticket.”

The blueprint still has several contract and authority ambiguities worth resolving before implementation. They concern the tracker/controller itself, not the old Subway Reader breakdown.

## What the blueprint gets right

### The tracker is a first-class owned product

The separation of authority is clean:

- Goblin Foundry owns apps, projects, designs, tickets, dependencies, runs, and workflow state.
- GitHub owns repositories, commits, checks, PRs, reviews, and merge state.
- GitHub Issues are not introduced as a mirrored second ticket system.

This matches the intended solo workflow and gives agents a simpler typed interface than a human-oriented third-party tracker.

### Tracker-first is intentional, not premature platform work

S1's App → Project → Ticket → Dependency model, state machine, API, and minimal client are appropriate because the user wants to operate the tracker before the factory is autonomous. Its exit criterion should be a real planning session that produces a fresh Subway Reader MVP backlog through the owned API.

The scope boundary remains important: S1 should deliver a useful planning/control surface, not a Linear-style board, generalized customization system, notification platform, or sync engine.

### The blueprint learned the correct lessons from v0

The strongest retained decisions are:

- one process and one authoritative store;
- no Zero or bidirectional sync engine;
- planning happens with the human before unattended execution;
- agents do not wait inside claimed worker runs;
- humans re-arm failed work;
- one implementation phase before adding planner/reviewer automation;
- deterministic verification and typed results;
- one provider and one PR per ticket;
- no L5 merging in v1;
- outcome measurement instead of output measurement.

### Deferrals are credible

The explicit deferral list is one of the best sections. It prevents research findings from automatically becoming v1 requirements. Keep it.

## Required clarifications before implementation

### 1. The controller, not the agent envelope, owns the authoritative run result

The blueprint puts the failure taxonomy in the phase envelope, including timeout, stall, sandbox death, and parse failures. Those failures often mean no valid envelope exists.

Separate these concepts:

#### Agent result envelope

Returned only when the Pi interaction completes sufficiently to produce a result:

```ts
type AgentEnvelope = {
  status: "completed" | "blocked";
  summary: string;
  changedFiles: string[];
  evidence: EvidenceClaim[];
  handoff?: string;
  blockingReason?: string;
};
```

#### Controller-owned run result

Authoritative for every terminal run, including failures outside the agent's control:

```ts
type RunFailureOrigin =
  | "provider"
  | "harness"
  | "protocol"
  | "verification"
  | "semantic"
  | "integration";

type RunDisposition =
  | "correct_same_session"
  | "return_to_human"
  | "retry_infrastructure"
  | "terminal";
```

The run result should contain a stable failure code, origin, disposition, human-readable detail, and relevant artifact references.

Retry disposition must be independent of failure category. A compilation failure can enter the bounded correction loop. A sandbox provisioning failure should not consume an agent correction. A repeated protected-path violation may terminate immediately. A push failure should be handled as integration recovery, not as another implementation attempt.

### 2. Clarify the git ownership contradiction

The controller flow says the controller commits, pushes, and opens the PR. The sandbox section says the worker pushes its branch with a per-run token. These are different trust and transport models.

Choose one explicit v1 path:

#### Option A: worker transports, controller integrates

- Agent edits but does not commit.
- A trusted worker-side wrapper, outside the agent interaction, runs final verification.
- The wrapper commits using controller-supplied provenance metadata and pushes the namespaced branch.
- The controller observes the pushed SHA and opens the PR.

#### Option B: controller pulls and integrates

- Worker exports a git bundle or patch plus evidence.
- Controller validates it, creates the commit, pushes, and opens the PR.
- The worker receives no GitHub write credential.

Option A is operationally simpler if the provider supports safe per-run GitHub tokens. The important distinction is that **the agent** must not own commit/push semantics even if a trusted process inside the sandbox performs them.

Update the architecture diagram and §3.2/§3.4/§3.6 to use the same ownership language.

### 3. “Protected verifier” needs a real enforcement mechanism

Pi is described as unrestricted inside the sandbox, yet a `tool_call` policy is expected to make selected fixtures and tests read-only. If the agent has unrestricted shell access as the same OS user, it may bypass a tool-level write restriction with shell commands, permission changes, generated scripts, or git operations.

The blueprint should distinguish:

- **Prevented during execution:** mounted read-only, owned by another user without privilege escalation, or held outside the agent workspace.
- **Detected after execution:** controller compares approved artifact hashes or the final diff and rejects modifications.
- **Hidden:** never placed in the worker sandbox; injected or executed by the controller/CI later.

For v1, hash/diff enforcement may be sufficient, but call it tamper detection rather than filesystem protection. If the worker needs the verifier in its inner loop, place it through a mechanism the agent cannot rewrite or verify its digest immediately before every execution.

### 4. Every run needs an immutable approved input revision

Designs are Markdown in the app repository, and an implementation PR may propose design reconciliation. That is a good workflow, but the implementation must not be judged against a specification it changed during the run.

At claim time, record an immutable input snapshot containing at least:

```text
app_id
project_id
ticket_id
ticket_revision
project_design_path + sha
ticket_design_path + sha, if separate
acceptance_revision
factory_config_sha
repository_base_sha
risk_lane
declared_scope
```

Verification evaluates against this approved snapshot. Proposed design changes remain visible in the PR but take effect only after merge/approval. This also makes reruns and outcome comparisons meaningful.

### 5. Separate repository policy from ticket-specific execution input

The proposed per-repository policy includes `declaredScope`, but declared scope belongs to an approved ticket revision. Split the inputs:

#### Repository policy

- default model and effort;
- maximum budget/turn/time ceilings;
- verification command;
- protected paths and artifact classes;
- default maximum diff;
- egress rules;
- repository-specific integration settings.

#### Ticket/run input

- approved scope;
- acceptance criteria;
- risk lane;
- dependency snapshot;
- task-specific budget override within repository ceilings;
- allowed exceptional paths, if human-approved.

The controller compiles these into an immutable effective run policy and stores it with the run.

### 6. Resolve the database/topology wording

“One process, one database, one port” is compatible naturally with SQLite. Postgres is a separate server process/service, even if the application itself is a single process. The decision is therefore not entirely neutral.

The blueprint can remain undecided, but state the tradeoff accurately:

- **SQLite WAL:** simplest deployment and backup for one user and one controller; atomic claims can use transactions or conditional `UPDATE ... RETURNING` without `SKIP LOCKED`.
- **Postgres:** preserves more v0 claim code and supports future concurrent controllers, but adds deployment, backup, credentials, and another process.

Do not design the v1 claim contract around `FOR UPDATE SKIP LOCKED` unless Postgres is selected. Define behavioral semantics—atomic lease acquisition—then implement them for the chosen store.

### 7. Define the minimum tracker state machine in the blueprint

The exact state set is deferred to S1, but the blueprint already relies on approval, readiness, work, failure, PR review, merge, and shipping semantics. A small conceptual state machine would remove ambiguity without over-designing UI labels.

Suggested initial lifecycle:

```text
draft
  → ready               human approves design/scope
  → running             controller holds active lease
  → needs_human         question, semantic route, terminal run failure
  → ready               human explicitly re-arms
  → ready_for_review    PR exists; CI/review state is observed separately
  → done                accepted merge/ship policy satisfied
  → cancelled
```

Important rules:

- Lease expiry does not silently make a failed ticket runnable again.
- A reaper records a run failure and routes the ticket to `needs_human`.
- Agents may propose results but cannot approve, re-arm, or mark shipped.
- Status is workflow state; CI status and PR review status should be separate observed fields, not more ticket states.

The names may change during S1. The transition authority and failure behavior should not remain implicit.

### 8. Define how GitHub state projects back into the tracker

GitHub remains authoritative for PRs, checks, reviews, and merges, but the morning view and dependency unblocking require selected integration state locally.

Store or derive at least:

```text
pr_url / pr_number
head_sha
ci_state
review_state
merged_at
merge_sha
last_observed_at
```

This is not GitHub Issues synchronization and does not create a second ticket source of truth. It is a projection of the integration artifact attached to a ticket/run.

Specify whether updates arrive through webhooks, periodic polling, or both. For one user, periodic reconciliation plus an optional webhook endpoint may be simpler and more robust than making webhook delivery part of correctness.

### 9. Define restart reconciliation before calling the controller stateless

“Stateless across restarts; tracker is truth” is a good goal, but the blueprint needs the recovery rule for runs whose controller dies while the sandbox or Pi process remains alive.

On startup, the controller should reconcile nonterminal runs against provider and GitHub state:

- sandbox exists and process is live → reattach or continue observation;
- sandbox exists but process is terminal → collect artifacts and classify;
- sandbox is gone → record provider/harness failure and route to human;
- branch/PR already exists → adopt it idempotently rather than creating another;
- lease expired with ambiguous external state → quarantine for human attention, not automatic rerun.

Every external operation needs an idempotency key based on run ID. Human re-arm controls a new agent attempt; reconciliation of the same attempt may be automatic.

### 10. Separate stored evidence from agent evidence claims

The envelope's `evidence` field is an agent assertion. `verify.json`, command logs, patches, screenshots, session JSONL, and provider usage are controller-observed artifacts.

Model them distinctly:

- `evidence_claim`: what the agent says it did or verified;
- `artifact`: immutable content or URI plus digest, producer, type, and retention policy;
- `gate_result`: controller interpretation of a verification command;
- `run_event`: operational state transition;
- `run_result`: authoritative terminal outcome.

They do not necessarily require five database tables in S1. The conceptual distinction should exist in the contracts so v0's schema breadth is not accidentally recreated and agent assertions are not treated as proof.

## Tracker-specific recommendations

### Keep S1 useful but narrow

S1 should support the intended real planning session:

- create/show/update an app;
- create/show/update a project;
- store approved design references and revisions;
- create/show/update tickets;
- declare blocking ticket relationships;
- compute the ready frontier;
- approve and re-arm through explicit human commands;
- expose all of this through the typed API and a minimal CLI or form.

Defer from S1 unless the planning session proves they are required:

- configurable workflows;
- custom status creation;
- rich comments and mentions;
- notifications;
- arbitrary saved views;
- real-time collaboration;
- drag-and-drop board behavior;
- label and milestone entities with their own lifecycle;
- generalized plugin systems;
- import/export formats beyond the one legacy import needed now.

### Treat design history as a domain concept

Storing path + SHA is the correct starting point when designs live in git. The tracker should still retain which revision was:

- proposed;
- approved;
- used by a particular run;
- superseded;
- reconciled by a merge.

This may initially be an append-only event/revision record rather than a large `Design` subsystem.

### Give agents narrow task-scoped access

Agents benefit from the owned tracker only if the interface is easier and safer than Linear. Expose intent-level operations rather than generic record mutation:

```text
factory app show <id>
factory project context <id>
factory ticket show <id> --approved-revision
factory ticket ready
factory ticket propose <id> --result <file>
factory run heartbeat <id>
factory run complete <id> --envelope <file>
```

An implementation worker should receive a task-scoped capability. It should not be able to browse private unrelated apps, approve its own design, re-arm itself, rewrite canonical status, or mark work shipped.

### Avoid premature multi-worker machinery without removing correct leases

Even one controller benefits from an atomic lease because crashes and overlapping ticks can duplicate work. Implement the smallest correct lease; do not build a distributed queue or concurrent-controller system.

The lease record should include:

```text
run_id
ticket_id
lease_owner
leased_at
heartbeat_at
expires_at
attempt
```

Lease expiry triggers reconciliation and human attention, not automatic execution of a new run.

## Changes requested in the build order

Keep tracker-first, but adjust names and exit criteria so the legacy Subway Reader tickets do not become accidental commitments:

| Slice | Recommended wording | Exit criterion |
|---|---|---|
| S1 | Tracker core: App, Project, approved design revision, Ticket, Dependency, minimal lifecycle, API, minimal human client | A fresh Subway Reader MVP project is created through the tracker; an agent-assisted planning conversation produces approved vertical-slice tickets and the ready frontier is correct |
| S2 | Approved ticket snapshot, agent envelope, controller run-result schema, failure taxonomy and disposition | A hand-run Pi session consumes one approved ticket snapshot; successful, malformed, blocked, and timed-out results classify correctly |
| S3 | Repository verification contract | A representative repository emits a valid `verify.json`; tampering and failure cases are classified correctly |
| S4 | Provider bakeoff, production provider adapter, warm image | One provider is selected from a bounded experiment; warm-start, cost, artifact export, credentials, teardown, and restart behavior are measured |
| S5 | Controller execution and integration loop | The first newly approved Subway Reader implementation ticket becomes a human-reviewed PR and is merged through the loop |
| S6 | Outcome telemetry and morning view | Ten real tickets have authoritative run/outcome rows and every attention state is visible without reading raw logs |

This preserves the intended tracker-first strategy while eliminating reliance on the precise legacy `SR-1` definition.

## Smaller wording and consistency changes

- Rename the agent phase from `build` to `implement`; reserve “build” for compilation and build-gate failures.
- Replace “ticket design has zero open questions” with “no unresolved question may materially change scope, acceptance, or an irreversible decision.” Known assumptions and deferred questions are allowed.
- Clarify P4: the sandbox provides execution isolation; the host/controller still enforces post-run policy and external authority boundaries.
- Replace “one process, one database, one port” with a deployment target unless SQLite is selected.
- Make the two-correction rule a maximum governed by disposition, total cost, wall time, and progress. Stop early when the same normalized failure repeats unchanged.
- A second phase should be added only when both conditions hold: the implementation phase is stable enough to build on, and outcome data identifies a problem that a separate phase is likely to solve.
- Keep Android emulator/KVM and warm Gradle cache constraints in the blueprint, but do not let the old ticket graph determine factory architecture or build order.
- Record semantic route-to-human results so a later review system can be evaluated for precision and eventually earn or reject L5 eligibility.

## Recommended decision order

The blueprint's next design sessions should proceed in this order:

1. Minimum tracker entities, fields, design-revision representation, and lifecycle.
2. Human versus agent transition authority.
3. SQLite versus Postgres based on the actual deployment target.
4. Fresh Subway Reader MVP/project planning through the new tracker.
5. Immutable approved ticket/run-input schema.
6. Agent envelope plus controller-owned run result, taxonomy, and disposition.
7. Verification and protected-artifact enforcement contract.
8. Worker/controller git ownership and artifact transport.
9. Provider bakeoff and controller deployment/restart behavior.
10. First product ticket through the complete loop.

## Final assessment

The blueprint's direction is approved. Building the owned ticket-management system first is consistent with the user's actual goal and should not be reframed as an incidental queue or replaced by legacy ticket files.

Before implementation, revise the blueprint to resolve four foundational boundaries:

1. controller-owned run results versus optional agent envelopes;
2. worker versus controller ownership of commit/push operations;
3. actual enforcement of protected verification artifacts;
4. immutable approved design/ticket revisions for every run.

Then specify the minimal tracker lifecycle and restart reconciliation rules. The rest can remain slice-level decisions. Subway Reader should enter after S1 as a freshly planned real project and proving workload, not as a fixed inherited ticket graph.
