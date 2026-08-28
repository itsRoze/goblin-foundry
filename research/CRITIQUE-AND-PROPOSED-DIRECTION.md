# Critique and proposed direction

**Date:** 2026-08-26  
**Status:** Input for a future revision of `SYNTHESIS.html`; not yet an agreed blueprint  
**Source:** Review of `research/SYNTHESIS.html` followed by discussion of the intended product and first proving project

## Executive summary

The synthesis has a strong architectural spine:

- deterministic orchestration outside the agent;
- fresh context per task and resumed context for bounded corrections;
- cloud sandboxes as the security boundary;
- small vertical slices;
- validation evidence recorded as data;
- outcome and rework measurements rather than generated-code volume;
- history manipulation owned by the controller rather than by agents.

The main concern is scope. The combined adopt list risks turning Goblin Foundry into a general software-factory platform before it can produce useful software. The first version should prove one complete workflow on one real product, with one provider, one controller, one task model, and one human-reviewed delivery path.

The first proving product will be an **offline Android RSS reader**. Goblin Foundry should be built while it builds that app. This provides concrete feature work, UI work, persistence, parsing, networking, background jobs, offline behavior, and Android-specific validation without requiring the factory to solve every kind of software development first.

The proposed owned ticket-management system changes the earlier recommendation about Beads and GitHub Issues. The tracker is not merely a queue: it is intended to be the durable product and design memory for multiple apps and projects. Owning that domain is reasonable. The implementation should nevertheless begin with a small data model and a narrow agent-facing API rather than a complete Linear replacement.

## Working principle

> Agents produce candidates. Deterministic code enforces boundaries. Evidence informs trust. The human owns intent and irreversible decisions.

This is slightly broader than “Agent proposes, code disposes.” Deterministic checks are excellent at enforcing encoded rules, but they cannot fully judge whether software expresses the intended behavior or is a good long-term design.

## What remains strong in the synthesis

### Deterministic control plane

Sequencing, retry limits, phase transitions, claims, permissions, budgets, and merges should be controller-owned code. Agents should return typed results and should not decide whether the overall workflow is complete.

### Session policy

Use a fresh session for a new ticket or a genuinely different role. Resume the same session for a bounded correction within the same stage because it retains the evidence and discoveries that led to the failure. Do not resume across a model change.

### Security boundary

Pi can operate freely inside a disposable sandbox, but the sandbox receives only the minimum credentials, egress, repository scope, and lifetime needed for its task. No production credentials should be available.

### Vertical slices

The controller and planning workflow should bias toward small, independently demonstrable slices rather than horizontal layer-by-layer plans. The Android RSS reader is a good test of this discipline.

### Outcome measurement

Measure accepted and surviving work, human correction time, cost, retries, reverts, and follow-up fixes. Do not optimize for generated lines, agent commits, or raw PR count.

## Disagreements and changes to the synthesis

### 1. “Only deterministic oracles may block” is too absolute

Use this policy instead:

- a deterministic failure blocks progression;
- a high-confidence semantic concern routes the task to a human;
- a low-confidence semantic concern annotates the PR;
- absence of required semantic review blocks only the risk classes configured to require it.

An LLM reviewer should not autonomously reject code as incorrect, but it may revoke eligibility for an unattended path. A deterministic suite can consistently approve the wrong behavior when the encoded specification is incomplete.

### 2. Hidden acceptance is selective, not universal

Held-out tests are valuable for regression fixes, stable external contracts, security invariants, migrations, and evaluation of the factory itself. They are often excessive for exploratory features and UI work.

The default should be a **protected verifier**, not necessarily a hidden verifier. A worker may be allowed to read an acceptance contract without being able to modify it. Public repository tests should remain the normal inner loop.

### 3. Own the tracker, but avoid two sources of truth

Beads plus GitHub Issues would introduce synchronization semantics before they are needed: conflict resolution, dependency-edge mapping, partial failures, reopen behavior, deduplication, and authority over edits.

The new direction is:

- Goblin Foundry's own database is authoritative for apps, projects, designs, tickets, dependencies, runs, and workflow state.
- GitHub is authoritative for git hosting, checks, pull requests, reviews, and merge state.
- Links and selected status projections may cross the boundary, but tickets are not bidirectionally mirrored into GitHub Issues in v1.
- Agents access the tracker through a small typed API or CLI, not through direct database writes.
- Every mutation is validated, authorized, and recorded with actor, run, timestamp, and prior/new state.

Beads remains a useful reference for atomic claims, dependency-aware readiness, and execution metadata. It need not become a runtime dependency.

### 4. Do not label a sandbox provider “adopt” before measurement

Define a deliberately small provider contract, implement one provider, and run real Android-app tasks. Measure startup latency, CPU and memory use, interruption recovery, credential behavior, artifact export, and cost. Add a second provider only when there is evidence that portability work is valuable.

The abstraction should cover the common requirements and expose provider capabilities explicitly. It should not pretend that snapshot, fork, pause, proxy-authentication, filesystem, and timeout semantics are identical.

### 5. Mutation testing should start as a diagnostic

Mutation testing has high value in pure domain logic but can be expensive or noisy in Android UI code, framework adapters, generated code, concurrency, and defensive branches. Run it on selected modules or as a scheduled diagnostic first. Promote it to a blocking diff gate only after measuring runtime, equivalent mutants, and false-positive burden.

A zero-survivor-per-file policy should not be a universal v1 rule.

### 6. Evidence gates should protect invariants, not rituals

“Read before edit” can become agent theater: a read event does not demonstrate understanding. Prefer gates around meaningful invariants:

- protected paths and acceptance artifacts;
- secret and network access;
- declared file scope and maximum diff bounds;
- exact base and head tree verified;
- verification performed on a clean representation of the proposed tree;
- prohibited changes to generated or security-sensitive files.

Interaction patterns such as read-before-edit should initially be telemetry. Promote them only when outcome data shows that they improve results.

### 7. Use phase-level rather than tool-call-level git snapshots in v1

The pi session log already records fine-grained activity. Git trees should initially be saved at meaningful recovery points:

- task start;
- implementation complete;
- after each correction cycle;
- before and after automated repair;
- final submitted tree.

Store the tree or patch hash in the run record. Add tool-call-level snapshots only if actual recovery incidents justify their operational cost.

### 8. Defer stacked PRs and merge-queue machinery

The initial integration path should be one ticket, one branch, one PR, human approval, and squash merge. Use one bot identity that cannot approve its own work. Add stacking when dependency chains repeatedly prevent useful work, and add merge-queue automation when collision rate or queue latency becomes a measured problem.

### 9. Start with two review lanes, not unattended L5

- **L3:** human reads the full diff.
- **L4:** human reads the ticket, evidence, summary, and high-risk files, then spot-checks the diff.
- **L5:** deferred until a task class has enough observed outcomes to establish a safe policy.

L5 should be earned from data rather than assumed at launch. Dependency updates are not automatically safe because they can alter transitive behavior, build scripts, and supply-chain risk.

### 10. Reduce the initial metric set

Start with measurements that lead directly to operational decisions:

- success without human correction;
- human correction and review minutes;
- total cost per accepted task;
- wall-clock time;
- retry count and categorized failure reason;
- revert or corrective follow-up within 14 and 30 days;
- changed lines and files;
- validation duration and flaky-check rate;
- sandbox startup and idle time.

Structural metrics such as files over 350 lines, single-use-function share, duplication, and cyclomatic complexity should begin as non-blocking observations and be added only to answer a concrete concern.

## Owned ticket-management system

### Product intent

The management system is the durable memory and control surface for a solo portfolio of apps. An app may contain multiple projects. Projects carry current design context and contain dependency-aware tickets. Agents need simple, reliable read and mutation interfaces.

The concept diagram proposes this hierarchy:

```text
App
├── app context and factory configuration
└── Project
    ├── Project Design
    ├── Milestone(s)
    └── Ticket(s)
        ├── Ticket Design
        ├── Status
        ├── Labels
        └── blocking relationships
```

The diagram's workflow covers three entry points:

1. A new app idea becomes an app, an MVP project, a project design, and dependency-aware tickets.
2. A feature idea for an existing app becomes a project/design update and a set of tickets.
3. An existing ticket moves through design, implementation, review, human shipping, and design-document reconciliation.

### Recommended v1 domain model

Avoid prematurely making every concept a separately editable entity. Begin with:

#### App

- `id`
- `title`
- `description`
- `repository`
- `default_branch`
- `context_document`
- `factory_config`
- timestamps

#### Project

- `id`
- `app_id`
- `title`
- `description`
- `design_document`
- `state`
- timestamps

#### Ticket

- `id`
- `project_id`
- `title`
- `description`
- `design_document`
- `status`
- `risk_lane`
- `priority`
- `declared_scope`
- `acceptance_criteria`
- timestamps

#### TicketDependency

- `blocker_ticket_id`
- `blocked_ticket_id`

#### Run

- `id`
- `ticket_id`
- `phase`
- `status`
- `attempt`
- `sandbox_ref`
- `session_ref`
- `model`
- `base_sha`
- `result_sha`
- cost, token, timing, and terminal metadata

#### Artifact / Evidence

- `run_id`
- `kind`
- `uri` or content reference
- digest
- structured metadata

Labels and milestones can initially be simple ticket fields or tags unless the UI proves that they need independent lifecycle and behavior. Status should be a controlled enum/state machine, not a general table editable by agents.

### Readiness and claims

A ticket is ready when it is:

- in a runnable status;
- not blocked by any incomplete ticket;
- not already leased;
- approved for its next phase;
- within configured concurrency and risk limits.

Claims should be atomic database operations with an expiring lease. A worker receives one ticket snapshot plus immutable identifiers, not broad access to browse and mutate the whole portfolio. The controller, not the worker, owns claim, release, retry, and terminal transitions.

### Agent-facing contract

Prefer a small CLI or API with commands equivalent to:

```text
factory app show <app-id>
factory project show <project-id>
factory ticket show <ticket-id>
factory ticket ready
factory ticket propose-update <ticket-id> --result <file>
factory run heartbeat <run-id>
factory run complete <run-id> --envelope <file>
```

Agents may propose design and ticket updates, but the controller validates transitions and protected fields. Human-only transitions should include product/design approval, authorization for high-risk execution, and final shipping until evidence supports relaxing them.

### Design-document lifecycle

The diagram correctly includes updating designs after shipping. This should be explicit rather than an informal final step:

1. Ticket design is a scoped hypothesis before implementation.
2. The implementation produces evidence and may reveal stale assumptions.
3. Review identifies any required ticket- or project-design reconciliation.
4. Shipping is not complete until required documentation updates are accepted or recorded as follow-up tickets.

Avoid letting every implementation agent rewrite the canonical project design automatically. It should submit a proposed patch that is reviewed with the code or handled in a bounded documentation phase.

## First proving product: offline Android RSS reader

### Why it is a good proving project

It exercises several useful development modes:

- Android project setup and build tooling;
- UI and navigation;
- local database schema and migrations;
- RSS/Atom parsing against diverse inputs;
- network fetching and failure handling;
- background refresh;
- offline-first state and synchronization;
- import/export and OPML interoperability;
- accessibility and device/emulator validation;
- unit, integration, and UI tests.

It also provides strong deterministic seams without pretending the whole product can be judged by tests. Feed parsing and persistence can be thoroughly tested; visual quality and interaction design still require human judgment.

### Suggested MVP product definition

An Android app that lets a user:

- add an RSS or Atom feed by URL;
- refresh and store feed content locally;
- browse subscriptions and article lists while offline;
- open cached article content;
- mark articles read/unread and starred;
- retain state across restarts;
- see clear loading and failure states.

Defer discovery, accounts, cross-device sync, recommendation systems, full-text extraction, advanced filtering, and extensive customization until the core offline loop is sound.

### Candidate vertical slices

1. **App shell:** buildable Android app with navigation and a placeholder feed list.
2. **Local subscription:** add a feed URL and persist the subscription locally.
3. **Fetch and parse:** retrieve a fixture/real feed, parse entries, and persist them.
4. **Offline list:** display persisted entries with networking disabled.
5. **Article reading:** open a cached article and preserve read state.
6. **Refresh behavior:** manual refresh with observable progress, deduplication, and useful errors.
7. **Background refresh:** constrained scheduled refresh with testable policy.
8. **Starred/unread workflows:** update and filter durable local state.
9. **OPML:** import/export subscriptions after the core model stabilizes.

Each slice should be touchable on an emulator or device and independently reviewable. Architectural layers may be created as needed inside a slice rather than completed as separate horizontal projects.

### Validation strategy for this app

Use deterministic validation where it fits:

- Gradle build, formatting, lint, and static analysis;
- unit tests for RSS/Atom parsing using curated fixtures;
- database and migration tests;
- repository/use-case tests for offline behavior;
- emulator smoke tests for critical flows;
- screenshots or recordings as review evidence, not as automatic proof of visual quality;
- network-disabled acceptance scenarios for the core offline promise.

Protect canonical parsing fixtures and selected regression tests from implementation workers. Do not require hidden acceptance for every UI ticket. Keep human review for visual design, interaction quality, copy, and architectural fit.

## Proposed v1 factory loop

```text
human approves a designed ticket
        ↓
controller atomically claims it
        ↓
fresh sandbox + fresh pi session
        ↓
agent implements one bounded vertical slice
        ↓
repository-owned verification command emits structured evidence
        ↓
same session receives at most two bounded correction attempts
        ↓
controller creates branch/PR and attaches evidence
        ↓
human review and squash merge
        ↓
controller reconciles ticket/project design and records outcome
```

### Components to build for v1

- small TypeScript controller;
- one authoritative relational database, initially SQLite unless deployment needs dictate otherwise;
- minimal web UI for apps, projects, ticket dependencies, readiness, runs, and attention states;
- narrow agent-facing API/CLI;
- one sandbox provider;
- pi in RPC mode;
- one task-input schema and one phase-result envelope;
- repository-level factory configuration;
- one structured verification command;
- fresh task sessions plus bounded correction resumes;
- protected paths, credential boundaries, and egress restrictions;
- one branch and PR per ticket;
- cost, duration, correction, review, and outcome telemetry.

### Explicitly defer

- Beads integration or GitHub Issue synchronization;
- a second sandbox provider;
- stacked PRs;
- merge queues and persistent repair bots;
- validator-agent-authored gates;
- multi-stage LLM review chains;
- mutation testing as a global blocker;
- hidden acceptance for every task;
- tool-call-granular git snapshots;
- multiple GitHub App identities;
- automated model routing from `WEATHER.md`;
- L5 unattended merging;
- scheduled architecture/cleanup agents;
- private weekly benchmark infrastructure.

## Decisions to make next, in order

1. Define the RSS reader's MVP and explicit non-goals.
2. Choose the Android architecture and repository toolchain.
3. Define the minimum ticket lifecycle and human-only transitions.
4. Define the first ticket input schema and phase-result envelope.
5. Define the repository-owned verification contract.
6. Decide where the controller and tracker UI run.
7. Choose the first sandbox provider using the expected workload and budget.
8. Decide worker-to-controller artifact and git transport.
9. Establish the initial L3/L4 risk classification.
10. Implement one tracer-bullet ticket end to end before expanding orchestration.

## Recommended tracer bullet

The first end-to-end task should be intentionally small but real:

> Create the Android application shell, run its deterministic build and test commands in a cloud sandbox, return structured evidence, and open a human-reviewable PR from an owned tracker ticket.

This validates the tracker, claim, sandbox, pi session, repository contract, correction loop, evidence envelope, git transport, and human merge path without requiring feed parsing or a polished UI. The next ticket can add a single curated feed fixture and render its persisted entries offline.

