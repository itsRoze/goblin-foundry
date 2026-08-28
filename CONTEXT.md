# Goblin Foundry — domain context (S1)

Glossary of the tracker's language. No implementation details here; decisions live in `docs/adr/`.

## App
A product the factory works on; owns one git repository. Contains Projects and Tickets. Renamable; identity is an opaque id, not its name.

## Project
A body of work inside an App (e.g. "Subway Reader MVP"). Has a Project Design and contains Tickets. Renamable.

## Milestone
A named grouping of Tickets inside a Project. Not in S1 (wanted later).

## Design
A markdown document describing intent, stored in the tracker as part of the thing it describes: a **Project Design** (the shape of a project) or a **Ticket Design** (the plan for one Ticket). A living document — edited in place; not versioned in S1. *(Later slices snapshot it at claim time so a run is judged against the design it started with.)*

## Ticket
A unit of work — or, early in its life, just an idea. May belong to an App and a Project, or to neither (an orphan Ticket is an idea and can never become `ready`). Has a Status, a description, and optionally a Ticket Design. A Ticket flagged **simple** needs no Ticket Design to become `ready`. Identified by a global sequence number shown with a configurable prefix (`GF-12`); the number is never reused.

## Ticket Key
The display form of a Ticket's number: `<prefix>-<number>`, prefix configurable once per installation (default `GF`). Apps and Projects do not have keys.

## Ticket Dependency
A directed "A blocks B" relationship between two Tickets. B cannot proceed until A is done.

## Blocked
A *derived condition*, not a Status: a Ticket with at least one **open** blocker. A blocker is open unless it is `done` or `cancelled` — a cancelled Ticket means "not doing" and blocks nothing. Never a colour in the UI (outline glyph + strikethrough).

## Lifecycle / Status
Workflow state only (never CI or PR review state). S1 statuses, in order:

- `backlog` — an idea; not now, maybe for a while
- `todo` — decided: plan this next
- `planning` — planning conversation / design in progress
- `ready` — plan approved; developable
- `building` — someone is on it (you by hand; the controller from S5)
- `review` — PR open / being reviewed
- `done`
- `cancelled` — not doing; blocks nothing

`needs_human` (agent stuck) is added when a controller exists (S5). Transitions are a code-owned table; every Transition names its owner. In S1 all are human-owned.

## Ready Frontier
The set of Tickets the controller may claim: `ready` ∧ no incomplete blocker ∧ not leased (∧ within concurrency/risk limits, later). Computed, never stored.

## Claim Order
The human-chosen ordering of the Ready Frontier; the controller takes the first. Not in S1 (arrives with the controller).

## Lease
The controller's atomic hold on a Ticket while a run is alive. Expiry routes to `needs_human`; it never re-queues. Not in S1.

## Attention
Everything waiting on the human: approvals, re-arms, answers, reviews, design reconciliations. In S1 only approvals exist (Tickets in `planning`); there is no Home screen — the Kanban is home.

## Simple
A flag on a Ticket meaning "straightforward enough to build without a Ticket Design". A simple Ticket may go `todo → ready` directly.

## Lane (risk lane)
The human review depth a Ticket requires: `L3` (read the full diff) or `L4` (spot-check with evidence). Not in S1; set at intake from S2.

## Actor
Who performed a mutation: `human` or `agent` (an AI creating or editing on the human's behalf, e.g. the planner). Every mutation records actor, prior state, new state, timestamp. Later slices add `controller`.

## Transition
One arrow in the Lifecycle: a move of a Ticket from one Status to another (e.g. `ready → running`). Each Transition has an **owner** — who is allowed to trigger it. Dragging a card between kanban columns *is* a Transition; the board only offers arrows the dragger owns.
