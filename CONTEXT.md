# Goblin Foundry — domain context (S1)

Glossary of the tracker's language. No implementation details here; decisions live in `docs/adr/`.

## App
A product the factory works on; owns one git repository. Contains Projects and Tickets. Renamable; identity is an opaque id, not its name.

## Project
A body of work (e.g. "Subway Reader MVP"), usually inside an App. May exist with no App (created before it is known where it belongs) and may be moved to another App later; its Tickets go with it. Has a Project Design and contains Tickets. Renamable; identity is an opaque id, not its name.

## Archived
A reversible condition on an App or Project: out of the way, not gone. An archived thing is hidden from lists and pickers by default but still opens by its address; its Tickets are untouched and stay on the board. Archiving is about navigation, never workflow. A Ticket is never archived — it is `cancelled` (a workflow decision) or Trashed (a mistake).

## Trashed
A recoverable deletion of an App, Project or Ticket (something created by accident). A trashed thing is hidden everywhere and can be restored; after a grace period it is gone for good. Distinct from Archived (out of the way) and from `cancelled` (a decision not to do a Ticket).

## Milestone
A named grouping of Tickets inside a Project. Not in S1 (wanted later).

## Design
A markdown document describing intent, stored in the tracker as part of the thing it describes: a **Project Design** (the shape of a project) or a **Ticket Design** (the plan for one Ticket). A living document — edited in place, always live (there is no draft and no save step); not versioned in S1. *(Later slices snapshot it at claim time so a run is judged against the design it started with.)*

## Ticket
A unit of work — or, early in its life, just an idea. May belong to an App and a Project, or to neither (an orphan Ticket is an idea and can never become `ready`). A Ticket in a Project always shares that Project's App; a Ticket's App is chosen directly only when it has no Project. Has a Status, a description, and optionally a Ticket Design. A Ticket flagged **simple** needs no Ticket Design to become `ready`. Identified by a global sequence number shown with a configurable prefix (`GF-12`); the number is never reused.

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
- `done` — finished, however it got there: shipped out of `review`, or closed because it turned out to be done as a side effect of other work
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
A flag on a Ticket meaning "straightforward enough to build without a Ticket Design". A simple Ticket may go `todo → ready` directly, and may be *created* in `ready`. Simple means no plan is needed, not that no context is needed: a simple Ticket still needs an App, because an orphan can never be `ready`.

## Lane (risk lane)
The human review depth a Ticket requires: `L3` (read the full diff) or `L4` (spot-check with evidence). Not in S1; set at intake from S2.

## Actor
Who performed a mutation: `human` or `agent` (an AI creating or editing on the human's behalf, e.g. the planner). Every mutation records actor, prior state, new state, timestamp. Later slices add `controller`.

## Edit session
A stretch of continuous editing of one thing by one Actor, recorded as a single entry in that
thing's history rather than one entry per keystroke's worth of saving. What it remembers is the
text as it stood when the sitting began, so an edit session is the unit of recovery for a
Design. A human's session and an agent's session are always distinct, even back to back.
(ADR-0008.)

## View option
A per-device display preference on the Kanban: which card properties are shown, and whether `cancelled` cards are visible. Distinct from a **Filter**, which chooses *which* Tickets are on the board and lives in the URL so it can be bookmarked. Hiding `cancelled` is a View option, never a Filter.

## Transition
One arrow in the Lifecycle: a named move of a Ticket from one Status to another (e.g. `ready → building`, named `start`). Each Transition has a **name** and an **owner** — who is allowed to trigger it. A Ticket's current Status plus a name identifies exactly one arrow. Dragging a card between kanban columns *is* a Transition; the board only offers arrows the dragger owns.

The S1 verbs: `pick`, `plan`, `shelve` (moving freely among `backlog`/`todo`/`planning`), `approve` and `unapprove`, `start` and `stop`, `submit`, `ship`, `close`, `cancel`, `reopen`. Two of them share a destination: **ship** is a PR merged out of `review`; **close** records a Ticket that turned out to be done without ever being planned. **Reopen** takes a cancelled Ticket back to `backlog` — distinct from *restoring* one, which is un-Trashing it.

## Approve Guard
What a Ticket must have before it may be `ready` or beyond: an **App**, and a **Ticket Design** unless it is Simple. It is the single gate into the Ready Frontier — the same check whether the Ticket walks there, is created there, or is edited while there. A description is not part of it: intent lives in the title of a Simple Ticket and in the Design of any other.
