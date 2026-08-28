/grill-with-docs

We are planning **Slice 1 (S1) of Goblin Foundry v1**: the owned ticket-management system. Grill me on S1 only. Nothing about the controller, sandboxes, pi, verification, or GitHub integration is in scope unless a tracker decision depends on it — and then only enough to make the tracker decision.

## Read first

- `/Users/roze/dev/goblin-foundry/BLUEPRINT-v1.md` — §1, §3.1 (Tracker), §3.2 (Run inputs), §6 (S1 row), §7 (decision order 1–4). This is the architecture; do not re-litigate it.
- `/Users/roze/dev/goblin-foundry/research/CRITIQUE-AND-PROPOSED-DIRECTION.md` — "Owned ticket-management system" section.
- `/Users/roze/dev/goblin-foundry/TEMP-BLUEPRINT-v1-REVIEW.md` — "Tracker-specific recommendations" and clarifications 4, 6, 7, 10.
- `/Users/roze/dev/goblin-foundry/design/DESIGN.md` and `design/tokens.css` — house style and the vocabulary the UI already uses (workspaces, frontier, claim order, attention row, design revision row).
- `/Users/roze/dev/goblin-foundry/research/factories/goblin-factory-v0-postmortem.md` — §5 (what was overly complicated) and §6 (salvage), so we don't rebuild v0's schema breadth.
- `/Users/roze/dev/goblin-foundry/research/subway-reader/` — the reference project that S1 must be able to hold. Not the plan; a realistic load.

## Already decided — do not ask about these

- New codebase; nothing reused from `~/dev/factory` except contracts, prompts, lessons.
- Tracker first, in slices. No `Run`/`Evidence`/`Artifact` tables in S1.
- S1 ships a typed HTTP API (Hono + zod) as the one audited write path **and a thin web GUI over it**. I must be able to create and edit apps, projects, design revisions, tickets and dependencies by hand in the GUI; the API alone is not a usable S1. No TUI; a CLI is optional.
- Drag-and-drop is in S1: kanban status moves and claim order, as in the mockups. With no controller yet, every transition is human-owned; drop targets are driven by a transition table so controller-owned columns can later refuse drops and say who owns them (DESIGN.md §8).
- No Zero, no sync engine, no real-time collaboration.
- One process, one authoritative store.
- Designs are markdown in the app repository; the tracker stores `path + sha` per revision as an append-only revision record.
- Status is a code-owned state machine with human-only transitions (approve, re-arm, ship). Lease expiry never re-queues.
- Agents (later) get task-scoped, intent-level operations, not generic record mutation.
- Tickets are never mirrored to GitHub Issues.
- House style: DESIGN.md as written.

## What I need you to grill me on (blueprint decision order 1–4)

1. **Minimum entities and fields** for App, Project, DesignRevision, Ticket, TicketDependency — what is required in S1 to run one real planning session, and what is a field vs. its own entity (labels, milestones, priority, risk lane, declared scope, acceptance criteria, budget override).
2. **Lifecycle and authority**: the exact S1 status set (start from `draft → ready → running → needs_human → ready_for_review → done · cancelled`), which transitions exist in S1 when no controller exists yet, who may perform each, what gets recorded per mutation (actor, prior, new, timestamp), and how readiness/"ready frontier" is computed and exposed.
3. **Storage and deployment target**: SQLite vs Postgres, decided against where this process will actually run (laptop vs a small always-on VM) and how it is backed up; lease semantics expressed store-independently.
4. **Bootstrap**: how the Subway Reader MVP project and its first design revision get created through the API on day one, and what the first planning session needs from the tracker to produce approved vertical-slice tickets with dependencies.
5. **API and GUI shape**: resource vs intent-level endpoints, error and validation conventions, ids (human-readable keys like `SR-12` vs opaque); which screens S1 needs (board, ticket, project, home/frontier — per `design/rough-v5`) and which tiles on them are empty until later slices (runs, evidence, live meter); how the GUI stays fast without a sync engine (plain fetch + cache, optional polling).
6. **What S1 explicitly does not include**, written down, so the slice cannot grow (candidates: real-time sync, comments/mentions, notifications, saved views, custom statuses, anything that displays run/evidence data, import/export beyond one legacy import).

Push back where my answers contradict the blueprint or DESIGN.md, and say so. Prefer the smaller option whenever two are viable. Recommend an answer with every question.

## Outputs

- `CONTEXT.md` with the S1 domain vocabulary (App, Project, DesignRevision, Ticket, TicketDependency, lease, ready frontier, attention, lane) — updated inline as decisions land.
- One ADR per decision above (storage, lifecycle/authority, id scheme, API style, S1 non-goals).
- When there are no unresolved questions that could materially change scope, acceptance, or an irreversible decision, stop and tell me we are ready for `/to-spec`.

## Stopping rule

S1 is done when: a fresh Subway Reader MVP project is created in the GUI, an agent-assisted planning conversation produces approved vertical-slice tickets through the API, I can rearrange them by drag-and-drop, and the ready frontier is correct on screen. Anything not needed to reach that is out of S1.
